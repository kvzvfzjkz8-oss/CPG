import cron from 'node-cron';
import { query } from '../db/index.js';
import { runInstallmentCollection } from '../services/operationsService.js';
import { runAgiosBatch, runTenueCompteBatch } from '../services/feeService.js';
import { balayerCaisses, MONTANT_BASE_CAISSE } from '../services/clotureCaisseService.js';
import { auditAutomated } from '../services/auditService.js';

/**
 * ═══════════════════════════════════════════════════════════════════
 *  TÂCHES PLANIFIÉES
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Les agios sont récupérés automatiquement chaque 30 de chaque mois.
 *   Le logiciel récupère directement les crédits quand les dates
 *   d'échéances sont arrivées. »
 *
 * L'opérateur ne déclenche plus ces deux opérations : il les vérifie
 * après coup (relevé de contrôle, écran de vérification), et garde la
 * main pour corriger — annuler une transaction, décaler une échéance —
 * ou relancer manuellement si une tâche a échoué.
 *
 * Le compte technique (rôle admin) porte les écritures automatiques
 * pour rester traçable dans le journal comme n'importe quel acteur.
 */

async function getSystemActor() {
  const { rows } = await query(
    `SELECT id, role FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`
  );
  return rows[0] ?? null;
}

async function collectInstallments() {
  const actor = await getSystemActor();
  if (!actor) {
    console.error('[planifié] Aucun compte technique (rôle admin) trouvé : collecte des échéances annulée.');
    return;
  }

  try {
    const result = await runInstallmentCollection({ actorId: actor.id });
    await auditAutomated({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'operations.echeances_prelevees_auto',
      entityType: 'periode',
      entityId: new Date().toISOString().slice(0, 10),
      metadata: {
        verifiees: result.checked, payees: result.paid.length,
        retards: result.late.length, total: result.totalCollected,
      },
    });
    if (result.checked > 0) {
      console.log(
        `[planifié] Échéances : ${result.paid.length} prélevée(s), ${result.late.length} en retard, ${result.totalCollected} FCFA collectés.`
      );
    }
  } catch (error) {
    console.error('[planifié] Échec de la collecte automatique des échéances :', error.message);
  }
}

async function collectAgios() {
  const actor = await getSystemActor();
  if (!actor) {
    console.error('[planifié] Aucun compte technique (rôle admin) trouvé : collecte des agios annulée.');
    return;
  }

  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const periodEnd = now.toISOString().slice(0, 10);

  try {
    const result = await runAgiosBatch({ periodStart, periodEnd });
    await auditAutomated({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'operations.agios_preleves_auto',
      entityType: 'periode',
      entityId: `${periodStart}_${periodEnd}`,
      metadata: { comptes: result.applied, total: result.total },
    });
    console.log(`[planifié] Agios : ${result.applied} compte(s), ${result.total} FCFA prélevés.`);
  } catch (error) {
    console.error('[planifié] Échec du prélèvement automatique des agios :', error.message);
  }
}

async function collectTenueCompte() {
  const actor = await getSystemActor();
  if (!actor) {
    console.error('[planifié] Aucun compte technique (rôle admin) trouvé : collecte des frais de tenue annulée.');
    return;
  }

  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const periodEnd = now.toISOString().slice(0, 10);

  try {
    const result = await runTenueCompteBatch({ periodStart, periodEnd });
    await auditAutomated({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'operations.tenue_compte_preleve_auto',
      entityType: 'periode',
      entityId: `${periodStart}_${periodEnd}`,
      metadata: { comptes: result.applied, total: result.total },
    });
    console.log(`[planifié] Frais de tenue : ${result.applied} compte(s), ${result.total} FCFA prélevés.`);
  } catch (error) {
    console.error('[planifié] Échec du prélèvement automatique des frais de tenue :', error.message);
  }
}


/**
 * Le renvoi de 15h30 — « il faut que ce soit assez strict ».
 *
 * Toute caisse non clôturée l'est ici, et l'excédent au-delà du fonds
 * de caisse repart à la caisse principale. Le bouton de la caissière
 * reste : celle qui clôture elle-même à 15h20 ne verra jamais cette
 * tâche passer, et c'est le but — le logiciel rattrape, il ne remplace
 * pas.
 *
 * `motif` distingue les deux passages dans le journal de caisse, pour
 * qu'une ligne du soir ne se lise pas comme une clôture de 15h30.
 */
async function cloturerLesCaisses(motif) {
  const actor = await getSystemActor();
  if (!actor) {
    console.error('[planifié] Aucun compte technique (rôle admin) trouvé : renvoi des excédents annulé.');
    return;
  }

  try {
    const result = await balayerCaisses({ acteurId: actor.id, motif });
    const agies = result.resultats.filter((r) => r.action !== 'echec');

    // Le journal d'audit porte le detail caisse par caisse : c'est de
    // l'argent qui bouge sans qu'une main l'ait decide, le directeur
    // doit pouvoir savoir exactement quoi, chez qui, et combien.
    if (result.resultats.length > 0) {
      await auditAutomated({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'caisse.excedents_renvoyes_auto',
        entityType: 'periode',
        entityId: new Date().toISOString().slice(0, 10),
        metadata: {
          motif,
          fondsDeCaisse: MONTANT_BASE_CAISSE,
          renvoye: result.renvoye,
          echecs: result.echecs,
          caisses: result.resultats,
        },
      });
    }

    if (agies.length > 0) {
      console.log(
        `[planifié] Caisses : ${agies.length} traitée(s), ${result.renvoye} FCFA renvoyés à la caisse principale.`
      );
    }
    for (const echec of result.resultats.filter((r) => r.action === 'echec')) {
      console.error(`[planifié] Caisse de ${echec.nom} : ${echec.message}`);
    }
  } catch (error) {
    console.error('[planifié] Échec du renvoi automatique des excédents :', error.message);
  }
}

/**
 * Démarre les tâches planifiées. Appelé une fois au lancement du
 * serveur (src/server.js) — jamais pendant les tests, qui utilisent
 * createApp() directement sans passer par ce fichier.
 */
export function startScheduler() {
  // Chaque jour à 6h : les échéances arrivées à terme la veille ou
  // avant sont prélevées avant l'ouverture des agences.
  cron.schedule('0 6 * * *', collectInstallments);

  // Le 30 de chaque mois à 3h. Lecture au pied de la lettre de « chaque
  // 30 du mois » : février (et tout mois sans 30e jour) est donc
  // sauté cette année-là. Si l'intention est plutôt « le dernier jour
  // du mois », c'est ici qu'il faudra ajuster l'expression cron.
  cron.schedule('0 3 30 * *', collectAgios);

  // Le 25 de chaque mois à 3h — décision de la direction du
  // 14/10/2026. Le 1er, la plupart des comptes sont vides : les
  // salaires des entreprises partenaires arrivent en milieu de mois,
  // et prélever avant la paie mettait des agents à découvert pour un
  // forfait de 6 500 F. Au 25, les comptes sont approvisionnés.
  //
  // Une seule date, une seule fois par mois : le prélèvement
  // automatique qui suivait chaque paie a été retiré, c'est lui qui
  // avait fait payer deux fois 189 agents le 14/10.
  cron.schedule('0 3 25 * *', collectTenueCompte);

  // 15h30, heure de Libreville — et le fuseau est explicite, sans
  // quoi node-cron suit celui du serveur : Railway tourne en UTC, la
  // tâche serait partie à 16h30 locales, une heure après la fermeture.
  // C'est l'horaire donné par la direction, donc il est écrit tel quel.
  cron.schedule(
    '30 15 * * *',
    () => cloturerLesCaisses('Excédent renvoyé — clôture automatique de 15h30'),
    { timezone: 'Africa/Libreville' }
  );

  // Seconde passe à 19h : ce qui est entré après 15h30 ne doit pas
  // passer la nuit au guichet non plus. Le 23/10, deux appros de
  // 5 588 000 F au total ont été validés à 15h47, trente minutes après
  // la clôture — sans ce rattrapage, ils y seraient restés.
  cron.schedule(
    '0 19 * * *',
    () => cloturerLesCaisses('Excédent renvoyé — passage du soir'),
    { timezone: 'Africa/Libreville' }
  );

  console.log(
    'Tâches planifiées démarrées : échéances (quotidien, 6h) · agios (le 30, 3h) · '
    + 'frais de tenue (le 25, 3h) · renvoi des excédents de caisse (15h30 et 19h, heure de Libreville).'
  );
}

// Exportées pour permettre un déclenchement manuel de secours (route
// /admin/operations/echeances/executer et l'équivalent agios déjà en
// place) sans dupliquer la logique de résolution de l'acteur système.
export { collectInstallments, collectAgios, collectTenueCompte, cloturerLesCaisses, getSystemActor };
