import { query, withTransaction } from '../db/index.js';

/**
 * ═══════════════════════════════════════════════════════════════════
 *  CLÔTURE DE CAISSE ET RENVOI DE L'EXCÉDENT
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Il faut que le renvoi de l'argent à partir de 15H30 soit assez
 *   strict. Je constate qu'il y a des fois où l'argent reste encore
 *   dans la caisse. »
 *
 * Le soir, une caisse ne doit contenir que son fonds de roulement. Ce
 * qui dépasse repart à la caisse principale. C'était un bouton, et
 * c'est la raison du problème : au 27/10/2026, 15 journées d'activité
 * sur 23 n'avaient jamais été clôturées, dont une à 26 174 607 F
 * laissés au guichet.
 *
 * Même logique pour les deux chemins — le bouton de la caissière et la
 * tâche de 15h30 — pour qu'ils ne puissent pas diverger : un seul
 * endroit calcule l'excédent, écrit le retour et enregistre la
 * clôture.
 */

/**
 * Fonds de caisse laissé au guichet pour le lendemain. Au-delà,
 * l'argent repart. Valeur affichée à la caissière avant qu'elle
 * clôture, et appliquée telle quelle par la tâche planifiée.
 */
export const MONTANT_BASE_CAISSE = 200000;

/**
 * Écrit le retour d'excédent : une sortie d'espèces chez la caissière,
 * une entrée à la caisse principale. Les deux lignes vont ensemble —
 * d'où la transaction exigée par l'appelant.
 *
 * `acteurId` est la caissière quand elle clôture elle-même, et le
 * compte technique quand c'est la tâche planifiée : le journal doit
 * dire qui a fait bouger l'argent, pas faire porter à la caissière un
 * geste qu'elle n'a pas posé.
 */
async function renvoyerExcedent(client, { caissierId, montant, acteurId, motif }) {
  await client.query(
    `INSERT INTO caisse_operations
       (caissier_id, type, montant, motif, statut, decidee_le, decidee_par)
     VALUES ($1, 'retour_excedent', $2, $3, 'validee', now(), $4)`,
    [caissierId, montant, motif, acteurId]
  );
  await client.query(
    `INSERT INTO caisse_principale_mouvements (type, montant, caissier_id, motif, cree_par)
     VALUES ('alimentation', $1, $2, $3, $4)`,
    [montant, caissierId, motif, acteurId]
  );
}

/** Le solde d'espèces courant d'une caissière, tel que la vue le donne. */
async function soldeEspeces(client, caissierId) {
  const { rows } = await client.query(
    'SELECT COALESCE(solde, 0) AS solde FROM caisse_soldes WHERE caissier_id = $1',
    [caissierId]
  );
  return Number(rows[0]?.solde ?? 0);
}

/**
 * La clôture d'une caisse pour la journée en cours. Renvoie l'excédent
 * s'il y en a, puis enregistre la clôture.
 *
 * `automatique` distingue les deux appelants : false quand la
 * caissière clique, true quand la tâche de 15h30 le fait à sa place.
 * La colonne reste en base (migration 052) pour que le directeur voie
 * quelles caisses sont tenues et lesquelles sont rattrapées.
 *
 * L'unicité par caissière et par jour est tenue en base
 * (idx_caisse_clotures_unique_jour) : une seconde clôture le même jour
 * lève 23505, que l'appelant traduit.
 */
export async function cloturerCaisse({ caissierId, acteurId, automatique = false }) {
  return withTransaction(async (client) => {
    const solde = await soldeEspeces(client, caissierId);
    const excedent = Math.max(0, solde - MONTANT_BASE_CAISSE);

    if (excedent > 0) {
      await renvoyerExcedent(client, {
        caissierId,
        montant: excedent,
        acteurId,
        motif: automatique
          ? 'Excédent renvoyé — clôture automatique de 15h30'
          : 'Excédent renvoyé à la clôture',
      });
    }

    const { rows } = await client.query(
      `INSERT INTO caisse_clotures (caissier_id, solde_avant, excedent_renvoye, automatique)
       VALUES ($1, $2, $3, $4)
       RETURNING id, solde_avant, excedent_renvoye, cloturee_le, automatique`,
      [caissierId, solde, excedent, automatique]
    );
    return rows[0];
  });
}

/**
 * Le balayage : passe sur toutes les caissières en activité et ne
 * laisse à chacune que son fonds de caisse.
 *
 * Deux situations, deux traitements :
 *
 *   • caisse pas encore clôturée → on la clôture (automatique) et on
 *     renvoie l'excédent ;
 *
 *   • caisse déjà clôturée mais de l'argent est rentré depuis — un
 *     retrait annulé, un encaissement de fin de journée, un appro
 *     validé après coup, ce qui est arrivé le 23/10 à 15h47 — alors on
 *     renvoie le nouvel excédent SANS seconde clôture : la journée n'a
 *     qu'une clôture, et c'est la base qui l'impose. La trace du
 *     mouvement suffit, elle porte son motif.
 *
 * Une caissière en échec n'arrête pas les autres : le but est qu'aucun
 * tiroir ne passe la nuit chargé, pas qu'une erreur isolée fasse tout
 * échouer.
 */
export async function balayerCaisses({ acteurId, motif }) {
  const { rows: caissieres } = await query(
    `SELECT u.id, btrim(u.full_name) AS nom,
            COALESCE(cs.solde, 0) AS solde,
            EXISTS (
              SELECT 1 FROM caisse_clotures cl
              WHERE cl.caissier_id = u.id
                AND cl.jour_cloture = (now() AT TIME ZONE 'UTC')::date
            ) AS deja_cloturee,
            EXISTS (
              SELECT 1 FROM caisse_operations co
              WHERE co.caissier_id = u.id AND co.statut = 'validee'
                AND COALESCE(co.decidee_le, co.demandee_le) >= date_trunc('day', now())
            ) AS activite_du_jour
     FROM users u
     LEFT JOIN caisse_soldes cs ON cs.caissier_id = u.id
     WHERE u.role = 'caissier' AND u.status = 'actif'
     ORDER BY u.full_name`
  );

  const resultats = [];
  for (const c of caissieres) {
    const solde = Number(c.solde);
    const excedent = Math.max(0, solde - MONTANT_BASE_CAISSE);

    // Rien à faire : déjà clôturée et au niveau du fonds de caisse.
    if (c.deja_cloturee && excedent === 0) continue;

    // Journée sans guichet et tiroir au niveau du fonds de caisse : on
    // n'écrit pas de clôture. Un dimanche ou un jour de congé ne doit
    // pas laisser une ligne qui ferait croire à une journée tenue —
    // c'est précisément en comptant les clôtures manquantes qu'on a
    // mesuré le problème.
    if (!c.deja_cloturee && excedent === 0 && !c.activite_du_jour) continue;

    try {
      if (!c.deja_cloturee) {
        const cloture = await cloturerCaisse({ caissierId: c.id, acteurId, automatique: true });
        resultats.push({
          caissierId: c.id, nom: c.nom, action: 'cloture',
          solde, excedent: Number(cloture.excedent_renvoye),
        });
      } else {
        await withTransaction((client) => renvoyerExcedent(client, {
          caissierId: c.id, montant: excedent, acteurId, motif,
        }));
        resultats.push({ caissierId: c.id, nom: c.nom, action: 'renvoi', solde, excedent });
      }
    } catch (error) {
      resultats.push({
        caissierId: c.id, nom: c.nom, action: 'echec', solde, excedent,
        message: error.message,
      });
    }
  }

  return {
    resultats,
    renvoye: resultats.reduce((s, r) => s + (r.action === 'echec' ? 0 : r.excedent), 0),
    echecs: resultats.filter((r) => r.action === 'echec').length,
  };
}
