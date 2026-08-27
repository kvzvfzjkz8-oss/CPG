import { query, withTransaction } from '../db/index.js';
import { ApiError } from '../middleware/errorHandler.js';
import { parseSalaryCsv } from '../utils/csvParser.js';

/**
 * ═══════════════════════════════════════════════════════════════════
 *  OPÉRATIONS MENSUELLES DE L'OPÉRATEUR
 * ═══════════════════════════════════════════════════════════════════
 *
 * Le logiciel agit seul sur deux fronts, chaque mois :
 *   • les échéances de crédit sont prélevées automatiquement à leur
 *     date d'échéance (runInstallmentCollection, planifiée chaque
 *     jour — voir src/jobs/scheduler.js) ;
 *   • les agios sont prélevés automatiquement le 30 de chaque mois
 *     (feeService.runAgiosBatch, même planificateur).
 *
 * L'opérateur, lui :
 *   1. crédite les comptes des agents avec la paie transmise par leur
 *      employeur, en joignant le fichier reçu (creditAgentSalariesFromCsv) ;
 *   2. vérifie que les opérations automatiques se sont bien déroulées
 *      (fetchMonthlyReport, fetchTransactions) ;
 *   3. corrige une erreur si besoin : annule une transaction
 *      (reverseTransaction) ou propose la correction d'une échéance
 *      pas encore prélevée (proposeInstallmentAdjustment) — cette
 *      dernière n'entre en vigueur qu'après validation du directeur
 *      (decideInstallmentAdjustment) : l'opérateur propose, il
 *      n'applique jamais lui-même.
 *
 * Les déclenchements manuels (creditAgentSalaries, runInstallmentCollection
 * appelée directement, ou l'agios batch via catalog.routes.js) restent
 * exposés comme filet de rattrapage si la tâche planifiée a échoué ou
 * était indisponible — l'opérateur peut relancer à la main, il n'est
 * simplement plus le déclencheur habituel.
 */

/**
 * Retrouve un client à partir d'un identifiant de liste de paie :
 * numéro de téléphone, numéro client, ou à défaut nom complet — les
 * employeurs ne transmettent pas toujours de numéro. La correspondance
 * par nom est fragile (homonymes, orthographe) : elle ne s'applique
 * que si l'identifiant n'a la forme ni d'un téléphone ni d'un numéro
 * client, et un nom partagé par plusieurs clients échoue proprement
 * plutôt que de deviner.
 *
 * @param {Function} run  Exécuteur SQL — `query` en lecture seule, ou
 *   `client.query` lié à une transaction quand l'appelant va ensuite
 *   écrire. La fonction elle-même ne fait jamais d'écriture.
 */
async function findClientByIdentifier(run, identifiant) {
  const { rows } = await run(
    `SELECT u.id AS user_id, u.full_name, a.id AS account_id
     FROM users u
     JOIN accounts a ON a.user_id = u.id
     WHERE u.role = 'client' AND (u.phone = $1 OR u.client_number = $1)
     LIMIT 1`,
    [identifiant]
  );
  if (rows[0]) return { match: rows[0], ambiguous: false };

  const looksLikePhoneOrNumber = /^\+?\d/.test(identifiant) || /^CPG-/i.test(identifiant);
  if (looksLikePhoneOrNumber) return { match: null, ambiguous: false };

  const { rows: byName } = await run(
    `SELECT u.id AS user_id, u.full_name, a.id AS account_id
     FROM users u
     JOIN accounts a ON a.user_id = u.id
     WHERE u.role = 'client' AND lower(u.full_name) = lower($1)`,
    [identifiant]
  );
  if (byName.length === 1) return { match: byName[0], ambiguous: false };
  if (byName.length > 1) return { match: null, ambiguous: true };
  return { match: null, ambiguous: false };
}

function buildSalaryReference(employeur, periode) {
  return `PAIE-${employeur.toUpperCase().replace(/\s+/g, '_')}-${periode}`;
}

/**
 * Résout une liste de lignes de paie sans rien écrire — c'est le cœur
 * commun à l'aperçu (previewAgentSalaries) et au crédit réel
 * (creditAgentSalaries), pour qu'ils ne puissent jamais diverger sur
 * ce qui compte comme une ligne valide.
 */
async function resolveSalaryLines(run, { entries, employeur, periode }) {
  const reference = buildSalaryReference(employeur, periode);
  const resolved = [];
  const notFound = [];

  for (const entry of entries) {
    const { identifiant, montant } = entry;

    if (!Number.isInteger(montant) || montant <= 0) {
      notFound.push({ identifiant, motif: 'montant_invalide' });
      continue;
    }

    const { match, ambiguous } = await findClientByIdentifier(run, identifiant);

    if (ambiguous) {
      notFound.push({ identifiant, motif: 'nom_ambigu' });
      continue;
    }
    if (!match) {
      notFound.push({ identifiant, motif: 'client_introuvable' });
      continue;
    }

    // Rejeu : si l'opérateur relance le même lot par erreur (double
    // clic, timeout réseau), la contrainte évite un double crédit —
    // même compte, même référence, ne s'insère qu'une fois. Sans
    // cette vérification, deux clics créditeraient deux fois.
    const { rows: existing } = await run(
      `SELECT 1 FROM ledger_entries
       WHERE account_id = $1 AND reference = $2 AND type = 'salaire'`,
      [match.account_id, reference]
    );
    if (existing[0]) {
      notFound.push({ identifiant, motif: 'deja_credite_ce_mois' });
      continue;
    }

    resolved.push({ identifiant, montant, nom: match.full_name, accountId: match.account_id });
  }

  return { reference, resolved, notFound };
}

/**
 * Aperçu sans écriture : ce que ferait creditAgentSalaries si on le
 * confirmait, sans rien modifier en base. C'est la première étape du
 * flux d'import — l'opérateur voit qui serait crédité, pour combien,
 * et ce qui serait écarté, avant toute confirmation.
 */
export async function previewAgentSalaries({ entries, employeur, periode }) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new ApiError(422, 'Aucune ligne de paie fournie.');
  }

  const { reference, resolved, notFound } = await resolveSalaryLines(query, { entries, employeur, periode });

  return {
    reference,
    aCrediter: resolved.map(({ identifiant, montant, nom }) => ({ identifiant, montant, nom })),
    notFound,
    total: resolved.reduce((sum, r) => sum + r.montant, 0),
  };
}

/** Même aperçu, à partir du fichier CSV directement. */
export async function previewAgentSalariesFromCsv({ csvText, employeur, periode }) {
  const { entries, erreurs } = parseSalaryCsv(csvText);
  if (entries.length === 0) {
    throw new ApiError(422, 'Le fichier ne contient aucune ligne exploitable.');
  }
  const preview = await previewAgentSalaries({ entries, employeur, periode });
  return { ...preview, lignesInvalides: erreurs };
}

/**
 * Crédite les comptes d'une liste d'agents avec leur paie — deuxième
 * étape, appelée une fois l'aperçu validé par l'opérateur. Revalide
 * tout indépendamment de ce que l'aperçu a montré (l'état a pu changer
 * entre-temps) plutôt que de faire confiance à ce que le client envoie.
 *
 * @param {Array<{identifiant: string, montant: number}>} entries
 *   `identifiant` est un numéro de téléphone, un numéro client
 *   (CPG-xxxxx) ou un nom complet.
 * @param {string} employeur   Employeur pour lequel la paie est versée.
 * @param {string} periode     Période au format AAAA-MM, pour le libellé
 *                              et le regroupement en base.
 * @param {string} actorId     Opérateur qui déclenche l'opération.
 */
export async function creditAgentSalaries({ entries, employeur, periode, actorId }) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new ApiError(422, 'Aucune ligne de paie fournie.');
  }

  return withTransaction(async (client) => {
    const run = (sql, params) => client.query(sql, params);
    const { reference, resolved, notFound } = await resolveSalaryLines(run, { entries, employeur, periode });

    const credited = [];
    for (const line of resolved) {
      await run(
        `INSERT INTO ledger_entries (account_id, type, amount, label, reference, created_by)
         VALUES ($1, 'salaire', $2, $3, $4, $5)`,
        [line.accountId, line.montant, `Salaire ${employeur} — ${periode}`, reference, actorId]
      );
      credited.push({ identifiant: line.identifiant, nom: line.nom, montant: line.montant });
    }

    return {
      reference,
      credited,
      notFound,
      total: credited.reduce((sum, c) => sum + c.montant, 0),
    };
  });
}

/**
 * Même opération, à partir d'un fichier CSV joint par l'opérateur —
 * c'est le chemin normal : « L'Opérateur joint le fichier des salaires
 * à créditer avec les noms ou numéro de compte des agents. » Les
 * lignes mal formées du fichier sont signalées à part des identifiants
 * simplement introuvables, pour que l'opérateur distingue une erreur
 * de saisie d'un client qui n'existe pas chez CPG.
 */
export async function creditAgentSalariesFromCsv({ csvText, employeur, periode, actorId }) {
  const { entries, erreurs } = parseSalaryCsv(csvText);

  if (entries.length === 0) {
    throw new ApiError(422, 'Le fichier ne contient aucune ligne exploitable.');
  }

  const result = await creditAgentSalaries({ entries, employeur, periode, actorId });
  return { ...result, lignesInvalides: erreurs };
}

/**
 * Prélève les échéances de crédit arrivées à terme.
 *
 * Pour chaque échéance encore « à_venir » dont la date est dépassée :
 * si le compte a la provision suffisante, l'échéance est débitée et
 * marquée payée ; sinon elle passe en retard, sans mouvement d'argent.
 * Un crédit dont la dernière échéance est réglée passe automatiquement
 * au statut « soldé ».
 */
export async function runInstallmentCollection({ asOf, actorId }) {
  const cutoff = asOf ?? new Date().toISOString().slice(0, 10);

  const { rows: due } = await query(
    `SELECT i.id, i.credit_id, i.sequence, i.amount, i.due_date,
            c.reference, c.duration_months, c.user_id
     FROM installments i
     JOIN credit_requests c ON c.id = i.credit_id
     WHERE i.status = 'a_venir' AND i.due_date <= $1
     ORDER BY i.due_date`,
    [cutoff]
  );

  const paid = [];
  const late = [];

  for (const installment of due) {
    await withTransaction(async (client) => {
      // FOR UPDATE sur le compte : si l'opérateur relance la collecte
      // pendant qu'une transaction Mobile Money est en cours sur le
      // même compte, on attend plutôt que de lire un solde obsolète.
      const { rows: account } = await client.query(
        `SELECT a.id AS account_id, b.balance
         FROM accounts a
         JOIN account_balances b ON b.account_id = a.id
         WHERE a.user_id = $1
         ORDER BY a.created_at LIMIT 1
         FOR UPDATE OF a`,
        [installment.user_id]
      );

      if (!account[0] || account[0].balance < installment.amount) {
        await client.query(
          `UPDATE installments SET status = 'en_retard' WHERE id = $1`,
          [installment.id]
        );
        late.push({
          reference: installment.reference, sequence: installment.sequence,
          amount: installment.amount, soldeDisponible: account[0]?.balance ?? 0,
        });
        return;
      }

      const { rows: entry } = await client.query(
        `INSERT INTO ledger_entries (account_id, type, amount, label, reference, created_by)
         VALUES ($1, 'paiement_credit', $2, $3, $4, $5)
         RETURNING id`,
        [
          account[0].account_id, -installment.amount,
          `Échéance ${installment.sequence}/${installment.duration_months} — crédit ${installment.reference}`,
          installment.reference, actorId,
        ]
      );

      await client.query(
        `UPDATE installments SET status = 'payee', paid_at = now(), ledger_entry_id = $2 WHERE id = $1`,
        [installment.id, entry[0].id]
      );

      // Dernière échéance réglée : le crédit passe soldé. On revérifie
      // depuis la base plutôt que de compter sur ce lot, au cas où une
      // échéance antérieure aurait été réglée hors de cette collecte.
      const { rows: remaining } = await client.query(
        `SELECT count(*) AS restantes FROM installments
         WHERE credit_id = $1 AND status <> 'payee'`,
        [installment.credit_id]
      );
      if (Number(remaining[0].restantes) === 0) {
        await client.query(
          `UPDATE credit_requests SET status = 'solde' WHERE id = $1`,
          [installment.credit_id]
        );
      }

      paid.push({
        reference: installment.reference, sequence: installment.sequence,
        amount: installment.amount,
      });
    });
  }

  return {
    checked: due.length,
    paid,
    late,
    totalCollected: paid.reduce((sum, p) => sum + p.amount, 0),
  };
}

/**
 * Relevé de contrôle sur une période : ce qui a été crédité, prélevé,
 * et ce qui reste en retard. C'est l'écran qui permet à l'opérateur de
 * « s'assurer que les agios et intérêts ont bien été pris ».
 */
export async function fetchMonthlyReport({ periodStart, periodEnd }) {
  const [salaires, echeancesPrelevees, echeancesEnRetard, agios] = await Promise.all([
    query(
      `SELECT count(*) AS nombre, COALESCE(sum(amount), 0) AS total
       FROM ledger_entries
       WHERE type = 'salaire' AND created_at::date BETWEEN $1 AND $2`,
      [periodStart, periodEnd]
    ),
    query(
      `SELECT count(*) AS nombre, COALESCE(sum(-amount), 0) AS total
       FROM ledger_entries
       WHERE type = 'paiement_credit' AND created_at::date BETWEEN $1 AND $2`,
      [periodStart, periodEnd]
    ),
    query(
      `SELECT count(*) AS nombre, COALESCE(sum(amount), 0) AS total
       FROM installments WHERE status = 'en_retard'`
    ),
    query(
      `SELECT count(*) AS nombre, COALESCE(sum(amount), 0) AS total
       FROM applied_fees
       WHERE period_start >= $1 AND period_end <= $2`,
      [periodStart, periodEnd]
    ),
  ]);

  return {
    periode: { debut: periodStart, fin: periodEnd },
    salairesCredites: salaires.rows[0],
    echeancesPrelevees: echeancesPrelevees.rows[0],
    echeancesEnRetard: echeancesEnRetard.rows[0],
    agiosPreleves: agios.rows[0],
  };
}

/**
 * Statut des tâches planifiées : dernière exécution de chacune, telle
 * qu'enregistrée dans le journal d'audit (les tâches y écrivent déjà
 * systématiquement). Permet à l'opérateur de vérifier d'un coup d'œil
 * que le logiciel a bien tourné avant de contrôler le détail.
 */
export async function fetchSchedulerStatus() {
  const { rows } = await query(
    `SELECT DISTINCT ON (action) action, created_at, metadata
     FROM audit_log
     WHERE action IN ('operations.echeances_prelevees_auto', 'operations.agios_preleves_auto')
     ORDER BY action, created_at DESC`
  );

  const echeances = rows.find((r) => r.action === 'operations.echeances_prelevees_auto');
  const agios = rows.find((r) => r.action === 'operations.agios_preleves_auto');

  return {
    echeances: echeances
      ? { derniereExecution: echeances.created_at, ...echeances.metadata }
      : { derniereExecution: null },
    agios: agios
      ? { derniereExecution: agios.created_at, ...agios.metadata }
      : { derniereExecution: null },
  };
}

/**
 * Liste des transactions sur une période, pour la relecture manuelle
 * de l'opérateur. C'est l'écran de vérification proprement dit : les
 * agrégats de fetchMonthlyReport disent « combien », celui-ci dit
 * « lesquelles », avec de quoi identifier une transaction à annuler.
 */
export async function fetchTransactions({ periodStart, periodEnd, type }) {
  const { rows } = await query(
    `SELECT le.id, le.type, le.amount, le.label, le.reference, le.created_at,
            le.reversed_entry_id,
            u.full_name AS client, u.client_number,
            creator.full_name AS effectue_par,
            EXISTS(SELECT 1 FROM ledger_entries r WHERE r.reversed_entry_id = le.id) AS annulee
     FROM ledger_entries le
     JOIN accounts a ON a.id = le.account_id
     JOIN users u ON u.id = a.user_id
     LEFT JOIN users creator ON creator.id = le.created_by
     WHERE le.created_at::date BETWEEN $1 AND $2
       AND ($3::entry_type IS NULL OR le.type = $3)
     ORDER BY le.created_at DESC
     LIMIT 500`,
    [periodStart, periodEnd, type ?? null]
  );
  return rows;
}

/**
 * Annule une transaction en portant une écriture inverse — jamais en
 * la supprimant ni en la modifiant : le journal reste en ajout seul,
 * comme partout ailleurs dans ce schéma. C'est le pouvoir de correction
 * de l'opérateur sur ce que le logiciel (ou lui-même) a fait.
 *
 * Si la transaction annulée est le paiement d'une échéance, l'échéance
 * redevient « à_venir » : sinon l'échéancier du client resterait faux
 * après l'annulation, et un crédit soldé par erreur redevient actif.
 */
export async function reverseTransaction({ ledgerEntryId, motif, actorId }) {
  if (!motif || motif.trim().length < 5) {
    throw new ApiError(422, 'Un motif d’annulation est requis (5 caractères minimum).');
  }

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM ledger_entries WHERE id = $1 FOR UPDATE`,
      [ledgerEntryId]
    );
    const original = rows[0];
    if (!original) throw new ApiError(404, 'Transaction introuvable.');

    if (original.type === 'annulation') {
      throw new ApiError(
        422,
        'Une extourne ne s’annule pas elle-même. Annulez la transaction d’origine si elle doit être corrigée à nouveau.'
      );
    }

    const { rows: already } = await client.query(
      `SELECT 1 FROM ledger_entries WHERE reversed_entry_id = $1`,
      [ledgerEntryId]
    );
    if (already[0]) throw new ApiError(409, 'Cette transaction a déjà été annulée.');

    const { rows: reversal } = await client.query(
      `INSERT INTO ledger_entries (account_id, type, amount, label, reference, created_by, reversed_entry_id)
       VALUES ($1, 'annulation', $2, $3, $4, $5, $6)
       RETURNING id, amount, created_at`,
      [
        original.account_id, -original.amount,
        `Annulation — ${original.label} (${motif.trim()})`,
        original.reference, actorId, original.id,
      ]
    );

    let installmentRevert = null;

    if (original.type === 'paiement_credit') {
      const { rows: inst } = await client.query(
        `SELECT id, credit_id FROM installments WHERE ledger_entry_id = $1`,
        [original.id]
      );
      if (inst[0]) {
        await client.query(
          `UPDATE installments
           SET status = 'a_venir', paid_at = NULL, ledger_entry_id = NULL
           WHERE id = $1`,
          [inst[0].id]
        );
        // Le crédit peut ressortir du statut « soldé » si c'était sa
        // dernière échéance qui vient d'être annulée.
        await client.query(
          `UPDATE credit_requests SET status = 'approuve' WHERE id = $1 AND status = 'solde'`,
          [inst[0].credit_id]
        );
        installmentRevert = inst[0].id;
      }
    }

    return {
      reversalId: reversal[0].id,
      originalId: original.id,
      originalType: original.type,
      montantExtourne: -original.amount,
      installmentRevert,
    };
  });
}

/**
 * Retrouve l'échéancier d'un crédit par sa référence lisible
 * (CPG-xxxx) plutôt que par son UUID interne — c'est ce que
 * l'opérateur a sous les yeux, jamais l'identifiant technique.
 */
export async function fetchInstallmentsByCreditReference(reference) {
  const { rows: credit } = await query(
    `SELECT c.id, c.reference, c.status, u.full_name AS client
     FROM credit_requests c JOIN users u ON u.id = c.user_id
     WHERE c.reference = $1`,
    [reference]
  );
  if (!credit[0]) throw new ApiError(404, 'Dossier introuvable pour cette référence.');

  const { rows: installments } = await query(
    `SELECT id, sequence, due_date, original_due_date, amount, status, paid_at
     FROM installments WHERE credit_id = $1 ORDER BY sequence`,
    [credit[0].id]
  );

  return { credit: credit[0], installments };
}

/**
 * Applique réellement la correction de date — appelée uniquement par
 * decideInstallmentAdjustment() après validation du directeur. Jamais
 * exposée directement à l'opérateur : proposer une correction et
 * l'appliquer sont deux actions distinctes, portées par deux personnes
 * différentes (contrainte no_self_decision_echeance imposée en base).
 */
async function applyInstallmentDueDate(client, { installmentId, nouvelleDate, actorId }) {
  const { rows } = await client.query(
    `SELECT * FROM installments WHERE id = $1 FOR UPDATE`,
    [installmentId]
  );
  const installment = rows[0];
  if (!installment) throw new ApiError(404, 'Échéance introuvable.');
  if (installment.status !== 'a_venir') {
    throw new ApiError(
      409,
      'L’échéance a été prélevée entre-temps : la correction ne peut plus s’appliquer. Utilisez l’annulation pour revenir sur un prélèvement déjà effectué.'
    );
  }

  const { rows: updated } = await client.query(
    `UPDATE installments
     SET due_date = $2,
         original_due_date = COALESCE(original_due_date, due_date),
         adjusted_by = $3,
         adjusted_at = now()
     WHERE id = $1
     RETURNING id, sequence, due_date, original_due_date, amount, status`,
    [installmentId, nouvelleDate, actorId]
  );

  return updated[0];
}

/**
 * Propose une correction de date pour une échéance pas encore
 * prélevée. Ne modifie rien : « l'opérateur peut corriger l'échéance
 * mais toujours avec une validation du directeur » — cette fonction
 * pose la demande, decideInstallmentAdjustment() l'applique ou l'écarte.
 */
export async function proposeInstallmentAdjustment({ installmentId, nouvelleDate, motif, actorId }) {
  if (!motif || motif.trim().length < 5) {
    throw new ApiError(422, 'Un motif est requis pour proposer une correction (5 caractères minimum).');
  }

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM installments WHERE id = $1 FOR UPDATE`,
      [installmentId]
    );
    const installment = rows[0];
    if (!installment) throw new ApiError(404, 'Échéance introuvable.');
    if (installment.status !== 'a_venir') {
      throw new ApiError(409, 'Seule une échéance pas encore prélevée peut faire l’objet d’une correction.');
    }

    const { rows: existing } = await client.query(
      `SELECT 1 FROM installment_adjustment_requests WHERE installment_id = $1 AND status = 'en_attente'`,
      [installmentId]
    );
    if (existing[0]) {
      throw new ApiError(409, 'Une demande de correction est déjà en attente pour cette échéance.');
    }

    const { rows: created } = await client.query(
      `INSERT INTO installment_adjustment_requests (installment_id, nouvelle_date, motif, requested_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, installment_id, nouvelle_date, motif, status, requested_at`,
      [installmentId, nouvelleDate, motif.trim(), actorId]
    );

    return created[0];
  });
}

/** Demandes de correction d'échéance en attente d'arbitrage du directeur. */
export async function fetchPendingInstallmentAdjustments() {
  const { rows } = await query(
    `SELECT r.id, r.nouvelle_date, r.motif, r.requested_at,
            i.sequence, i.due_date AS date_actuelle, i.amount,
            c.reference AS credit_reference,
            demandeur.full_name AS demandeur
     FROM installment_adjustment_requests r
     JOIN installments i ON i.id = r.installment_id
     JOIN credit_requests c ON c.id = i.credit_id
     JOIN users demandeur ON demandeur.id = r.requested_by
     WHERE r.status = 'en_attente'
     ORDER BY r.requested_at`
  );
  return rows;
}

/**
 * Le directeur tranche : approuver applique la correction proposée,
 * rejeter l'écarte sans toucher à l'échéance. Le proposant ne peut pas
 * décider sa propre demande (voir la contrainte en base) ; l'erreur
 * qui en résulte est déjà claire sans qu'on ait besoin de la vérifier
 * nous-mêmes ici avant d'écrire.
 */
export async function decideInstallmentAdjustment({ requestId, approve, note, actorId }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM installment_adjustment_requests WHERE id = $1 FOR UPDATE`,
      [requestId]
    );
    const request = rows[0];
    if (!request) throw new ApiError(404, 'Demande de correction introuvable.');
    if (request.status !== 'en_attente') {
      throw new ApiError(409, 'Cette demande a déjà été traitée.');
    }
    if (request.requested_by === actorId) {
      throw new ApiError(403, 'Qui a proposé la correction ne peut pas la valider lui-même.');
    }

    let installment = null;
    if (approve) {
      installment = await applyInstallmentDueDate(client, {
        installmentId: request.installment_id,
        nouvelleDate: request.nouvelle_date,
        actorId,
      });
    }

    await client.query(
      `UPDATE installment_adjustment_requests
       SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4
       WHERE id = $1`,
      [requestId, approve ? 'approuve' : 'rejete', actorId, note ?? null]
    );

    return { statut: approve ? 'approuve' : 'rejete', installment };
  });
}
