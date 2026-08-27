import { query, withTransaction } from '../db/index.js';
import { computeFee, computeAgios, buildDailyBalances } from './feeCalculator.js';
import { classifyRateChange, RateError } from '../utils/rateVersioning.js';
import { getCeiling } from './productService.js';

/**
 * ═══════════════════════════════════════════════════════════════════
 *  SERVICES ANNEXES ET AGIOS
 * ═══════════════════════════════════════════════════════════════════
 *
 * Même principe que les produits de crédit : les barèmes de frais sont
 * versionnés, jamais écrasés. Un client contestant des agios prélevés
 * en mars doit pouvoir se voir opposer le barème applicable en mars,
 * pas celui d'aujourd'hui.
 *
 * Le calcul lui-même vit dans feeCalculator.js, sans dépendance, pour
 * rester testable en isolation.
 */

export async function listActiveFees() {
  const { rows } = await query(
    `SELECT * FROM current_fee_versions WHERE status = 'actif' ORDER BY name`
  );
  return rows;
}

export async function listAllFees() {
  const { rows } = await query(
    `SELECT f.id, f.code, f.name, f.description, f.basis, f.trigger_on, f.status,
            f.created_at, f.activated_at,
            v.id AS version_id, v.version, v.amount, v.rate,
            v.min_amount, v.max_amount, v.exempt_below, v.effective_from
     FROM fee_definitions f
     LEFT JOIN fee_versions v ON v.fee_id = f.id AND v.effective_to IS NULL
     ORDER BY f.created_at DESC`
  );
  return rows;
}

export async function getFeeHistory(feeId) {
  const { rows } = await query(
    `SELECT v.*, u.full_name AS cree_par
     FROM fee_versions v
     LEFT JOIN users u ON u.id = v.created_by
     WHERE v.fee_id = $1 ORDER BY v.version DESC`,
    [feeId]
  );
  return rows;
}

/** Plafond applicable selon la nature du frais. */
function ceilingScopeFor(basis) {
  if (basis === 'journalier_solde') return 'agios_daily';
  if (basis === 'pourcentage') return 'fee_percentage';
  return null; // un montant fixe n'est pas un taux
}

async function validateFeeScale(basis, scale) {
  const scope = ceilingScopeFor(basis);
  if (!scope) return;

  const ceiling = await getCeiling(scope);
  const rate = Number(scale.rate ?? 0);

  if (ceiling !== null && rate > ceiling) {
    throw new RateError(
      `Le taux demandé (${(rate * 100).toFixed(4)} %) dépasse le plafond autorisé de ${(ceiling * 100).toFixed(4)} %.`,
      'plafond_depasse'
    );
  }
}

/** Crée un service annexe avec son premier barème. Naît en brouillon. */
export async function createFee({ code, name, description, basis, triggerOn, scale, actorId }) {
  await validateFeeScale(basis, scale);

  return withTransaction(async (client) => {
    const { rows: fee } = await client.query(
      `INSERT INTO fee_definitions (code, name, description, basis, trigger_on, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'brouillon', $6)
       RETURNING id, code, name, basis, trigger_on, status`,
      [code, name, description ?? null, basis, triggerOn, actorId]
    );

    const { rows: version } = await client.query(
      `INSERT INTO fee_versions
         (fee_id, version, amount, rate, min_amount, max_amount, exempt_below, created_by, note)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7, 'Barème initial')
       RETURNING *`,
      [
        fee[0].id,
        scale.amount ?? 0,
        scale.rate ?? 0,
        scale.minAmount ?? 0,
        scale.maxAmount ?? null,
        scale.exemptBelow ?? 0,
        actorId,
      ]
    );

    return { fee: fee[0], version: version[0] };
  });
}

/** Nouveau barème de frais, soumis aux mêmes règles de délégation. */
export async function requestFeeScaleChange({ feeId, scale, actor, reason }) {
  const { rows } = await query(
    `SELECT f.basis, v.id AS version_id, v.version, v.rate
     FROM fee_definitions f
     JOIN fee_versions v ON v.fee_id = f.id AND v.effective_to IS NULL
     WHERE f.id = $1`,
    [feeId]
  );
  if (!rows[0]) throw new RateError('Service introuvable ou sans barème.', 'sans_version');

  const { basis, rate: currentRate, version } = rows[0];
  await validateFeeScale(basis, scale);

  const scope = ceilingScopeFor(basis);
  const ceiling = scope ? await getCeiling(scope) : null;

  // Un frais fixe n'a pas de taux : la notion de marge relative ne
  // s'applique pas, on compare les montants.
  const comparableCurrent = basis === 'fixe' ? Number(rows[0].amount ?? 0) : Number(currentRate);
  const comparableProposed = basis === 'fixe' ? Number(scale.amount ?? 0) : Number(scale.rate ?? 0);

  const decision = classifyRateChange({
    role: actor.role,
    currentRate: comparableCurrent,
    proposedRate: comparableProposed,
    ceiling: basis === 'fixe' ? null : ceiling,
  });

  if (decision.outcome === 'refus') {
    throw new RateError(
      decision.reason === 'plafond_depasse'
        ? 'Ce taux dépasse le plafond réglementaire enregistré.'
        : 'Votre poste ne permet pas de modifier les barèmes.',
      decision.reason
    );
  }

  if (decision.outcome === 'a_valider') {
    const { rows: request } = await query(
      `INSERT INTO rate_change_requests (target_type, target_id, payload, reason, requested_by)
       VALUES ('service', $1, $2, $3, $4)
       RETURNING id, status, requested_at`,
      [feeId, scale, reason, actor.id]
    );
    return {
      statut: 'a_valider',
      demande: request[0],
      message: 'Ce changement dépasse votre marge déléguée. Il attend la validation du directeur.',
    };
  }

  const created = await applyFeeVersion({
    feeId,
    scale,
    actorId: actor.id,
    approvedBy: actor.role === 'directeur' || actor.role === 'admin' ? actor.id : null,
    note: reason,
  });

  return { statut: 'applique', version: created };
}

/**
 * Crée une nouvelle version de barème de frais et clôture la
 * précédente. Appelée soit directement par un ajustement dans la marge
 * déléguée, soit par le directeur validant une proposition.
 */
export async function applyFeeVersion({ feeId, scale, actorId, approvedBy = null, note }) {
  return withTransaction(async (client) => {
    const { rows: current } = await client.query(
      'SELECT id, version FROM fee_versions WHERE fee_id = $1 AND effective_to IS NULL FOR UPDATE',
      [feeId]
    );
    if (!current[0]) throw new RateError('Ce service n’a pas de barème en vigueur.', 'sans_version');

    const now = new Date();
    await client.query('UPDATE fee_versions SET effective_to = $2 WHERE id = $1', [current[0].id, now]);

    const { rows: inserted } = await client.query(
      `INSERT INTO fee_versions
         (fee_id, version, amount, rate, min_amount, max_amount, exempt_below,
          effective_from, created_by, approved_by, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        feeId,
        current[0].version + 1,
        scale.amount ?? 0,
        scale.rate ?? 0,
        scale.minAmount ?? 0,
        scale.maxAmount ?? null,
        scale.exemptBelow ?? 0,
        now,
        actorId,
        approvedBy,
        note ?? null,
      ]
    );
    return inserted[0];
  });
}

export async function setFeeStatus({ feeId, status, actorId }) {
  // Mêmes casts explicites que setProductStatus, pour la même raison :
  // $2 employé à la fois comme enum et comme texte dans les CASE WHEN.
  const { rows } = await query(
    `UPDATE fee_definitions
     SET status = $2::product_status,
         activated_by = CASE WHEN $2::text = 'actif' THEN $3 ELSE activated_by END,
         activated_at = CASE WHEN $2::text = 'actif' THEN now() ELSE activated_at END
     WHERE id = $1
     RETURNING id, code, name, status`,
    [feeId, status, actorId]
  );
  if (!rows[0]) throw new RateError('Service introuvable.', 'introuvable');
  return rows[0];
}

/**
 * ─────────────────────────────────────────────────────────────────
 *  PRÉLÈVEMENT DES AGIOS
 * ─────────────────────────────────────────────────────────────────
 *
 * À lancer par une tâche planifiée, en général à chaque arrêté mensuel.
 *
 * Deux protections contre le double prélèvement, qui est la faute la
 * plus grave possible ici :
 *   1. La contrainte d'unicité sur (version, compte, période).
 *   2. La transaction, qui annule tout si l'écriture au journal échoue.
 *
 * Sans elles, relancer la tâche après un incident facturerait deux fois
 * les mêmes agios à tous les clients.
 */
export async function runAgiosForAccount({ accountId, periodStart, periodEnd, feeVersion }) {
  const { rows: opening } = await query(
    `SELECT COALESCE(SUM(amount), 0) AS balance
     FROM ledger_entries
     WHERE account_id = $1 AND created_at < $2`,
    [accountId, periodStart]
  );

  const { rows: entries } = await query(
    `SELECT created_at, amount FROM ledger_entries
     WHERE account_id = $1 AND created_at >= $2 AND created_at < ($3::date + 1)
     ORDER BY created_at`,
    [accountId, periodStart, periodEnd]
  );

  const dailyBalances = buildDailyBalances(
    Number(opening[0].balance),
    entries,
    periodStart,
    periodEnd
  );

  const result = computeAgios(dailyBalances, {
    rate: Number(feeVersion.rate),
    minAmount: Number(feeVersion.min_amount ?? 0),
    maxAmount: feeVersion.max_amount === null ? null : Number(feeVersion.max_amount),
    exemptBelow: Number(feeVersion.exempt_below ?? 0),
  });

  if (result.amount <= 0) return { accountId, amount: 0, skipped: true };

  return withTransaction(async (client) => {
    const { rows: entry } = await client.query(
      `INSERT INTO ledger_entries (account_id, type, amount, label, reference)
       VALUES ($1, 'frais', $2, $3, $4) RETURNING id`,
      [
        accountId,
        -result.amount,
        `Agios sur solde débiteur (${result.debitDays} jours)`,
        `AGIOS-${periodStart}`,
      ]
    );

    try {
      await client.query(
        `INSERT INTO applied_fees
           (fee_version_id, account_id, amount, basis_detail, period_start, period_end, ledger_entry_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          feeVersion.version_id ?? feeVersion.id,
          accountId,
          result.amount,
          { debitDays: result.debitDays, totalDebitBalance: result.totalDebitBalance, rate: feeVersion.rate },
          periodStart,
          periodEnd,
          entry[0].id,
        ]
      );
    } catch (error) {
      // 23505 = violation d'unicité : les agios de cette période ont
      // déjà été prélevés. La transaction est annulée, donc l'écriture
      // au journal disparaît aussi. Rien n'est facturé deux fois.
      if (error.code === '23505') {
        throw new RateError('Les agios de cette période ont déjà été prélevés.', 'deja_preleve');
      }
      throw error;
    }

    return { accountId, amount: result.amount, debitDays: result.debitDays };
  });
}

/** Passe tous les comptes en revue pour la période donnée. */
export async function runAgiosBatch({ periodStart, periodEnd }) {
  const { rows: fee } = await query(
    `SELECT * FROM current_fee_versions
     WHERE basis = 'journalier_solde' AND trigger_on = 'solde_debiteur' AND status = 'actif'
     LIMIT 1`
  );

  if (!fee[0]) return { applied: 0, message: 'Aucun barème d’agios actif.' };

  const { rows: accounts } = await query('SELECT id FROM accounts');

  const results = [];
  for (const account of accounts) {
    try {
      const result = await runAgiosForAccount({
        accountId: account.id,
        periodStart,
        periodEnd,
        feeVersion: fee[0],
      });
      if (result.amount > 0) results.push(result);
    } catch (error) {
      if (error.code === 'deja_preleve') continue;
      throw error;
    }
  }

  return {
    applied: results.length,
    total: results.reduce((sum, r) => sum + r.amount, 0),
    details: results,
  };
}

/** Frais ponctuel déclenché par une opération (retrait, transfert…). */
export async function applyTriggeredFee({ accountId, triggerOn, operationAmount }) {
  const { rows } = await query(
    `SELECT * FROM current_fee_versions WHERE trigger_on = $1 AND status = 'actif' LIMIT 1`,
    [triggerOn]
  );
  if (!rows[0]) return { amount: 0 };

  const version = rows[0];
  const amount = computeFee(
    {
      basis: version.basis,
      amount: Number(version.amount),
      rate: Number(version.rate),
      minAmount: Number(version.min_amount ?? 0),
      maxAmount: version.max_amount === null ? null : Number(version.max_amount),
      exemptBelow: Number(version.exempt_below ?? 0),
    },
    operationAmount
  );

  if (amount <= 0) return { amount: 0 };

  return withTransaction(async (client) => {
    const { rows: entry } = await client.query(
      `INSERT INTO ledger_entries (account_id, type, amount, label)
       VALUES ($1, 'frais', $2, $3) RETURNING id`,
      [accountId, -amount, version.name]
    );

    await client.query(
      `INSERT INTO applied_fees (fee_version_id, account_id, amount, basis_detail, ledger_entry_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [version.version_id, accountId, amount, { operationAmount, basis: version.basis }, entry[0].id]
    );

    return { amount, label: version.name };
  });
}
