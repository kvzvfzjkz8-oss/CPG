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
export async function runAgiosForAccount({
  accountId, periodStart, periodEnd, feeVersion, client: externalClient,
}) {
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

  // Même raison que pour les frais de tenue : l'appelant peut fournir
  // sa transaction pour que le prélèvement soit solidaire du reste.
  const apply = async (client) => {
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
      // déjà été prélevés. La transaction est annulée — la nôtre ou
      // celle de l'appelant — donc l'écriture au journal disparaît
      // aussi. Rien n'est facturé deux fois.
      if (error.code === '23505') {
        throw new RateError('Les agios de cette période ont déjà été prélevés.', 'deja_preleve');
      }
      throw error;
    }

    return {
      accountId, amount: result.amount, debitDays: result.debitDays,
      ledgerEntryId: entry[0].id,
    };
  };

  return externalClient ? apply(externalClient) : withTransaction(apply);
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

/**
 * ─────────────────────────────────────────────────────────────────
 *  FRAIS DE TENUE DE COMPTE
 * ─────────────────────────────────────────────────────────────────
 *
 * Contrairement aux agios, un montant fixe, dû par tous les comptes,
 * peu importe le solde — c'est le coût de possession du compte, pas
 * une pénalité de découvert. Prélevé même si ça rend le compte
 * négatif : la période sert uniquement à empêcher un double
 * prélèvement le même mois, pas à conditionner le prélèvement
 * lui-même.
 */
export async function runTenueCompteForAccount({
  accountId, periodStart, periodEnd, feeVersion, client: externalClient,
}) {
  const amount = computeFee({
    basis: feeVersion.basis,
    amount: Number(feeVersion.amount),
    rate: Number(feeVersion.rate),
    minAmount: Number(feeVersion.min_amount ?? 0),
    maxAmount: feeVersion.max_amount === null ? null : Number(feeVersion.max_amount),
  });

  if (amount <= 0) return { accountId, amount: 0, skipped: true };

  // Transaction fournie par l'appelant quand ce prélèvement doit être
  // solidaire d'autre chose — c'est le cas du rattrapage ponctuel, qui
  // ne doit pas laisser un frais prélevé si la validation du directeur
  // échoue ensuite. Sinon, sa propre transaction, comme le batch.
  const apply = async (client) => {
    let idEcriture = null;
    try {
      const { rows: entry } = await client.query(
        `INSERT INTO ledger_entries (account_id, type, amount, label, reference)
         VALUES ($1, 'frais', $2, $3, $4) RETURNING id`,
        [accountId, -amount, 'Frais de tenue de compte', `TENUE-${periodStart}`]
      );
      idEcriture = entry[0].id;

      await client.query(
        `INSERT INTO applied_fees
           (fee_version_id, account_id, amount, basis_detail, period_start, period_end, ledger_entry_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          feeVersion.version_id ?? feeVersion.id,
          accountId,
          amount,
          { basis: 'fixe' },
          periodStart,
          periodEnd,
          entry[0].id,
        ]
      );
    } catch (error) {
      // 23505 = violation d'unicité : déjà prélevé sur cette période.
      // Rien n'est facturé deux fois — l'annulation de la transaction
      // (la nôtre, ou celle de l'appelant) efface aussi l'écriture au
      // journal qui vient d'être posée juste au-dessus.
      if (error.code === '23505') {
        throw new RateError('Les frais de tenue de cette période ont déjà été prélevés.', 'deja_preleve');
      }
      throw error;
    }

    return { accountId, amount, ledgerEntryId: idEcriture };
  };

  return externalClient ? apply(externalClient) : withTransaction(apply);
}

/**
 * Ramène n'importe quelle date au mois civil qui la contient.
 *
 * Les frais de tenue sont un forfait MENSUEL : la période ne peut donc
 * être que le mois entier. Chaque appelant calculait jusqu'ici sa
 * propre période — le planificateur du 1er enregistrait « du 01/10 au
 * 01/10 », un prélèvement déclenché après une paie « du 01/10 au
 * 14/10 ». La contrainte d'unicité porte sur (barème, compte, début,
 * fin) : trois fins différentes, trois lignes autorisées pour le même
 * mois, et la protection contre le double prélèvement ne se
 * déclenchait jamais.
 *
 * C'est ce qui s'est produit le 14/10/2026 : une paie QSR d'un seul
 * agent a redéclenché le batch et reprélevé 189 comptes déjà réglés,
 * soit 1 228 500 F. Normaliser ici plutôt que chez l'appelant ferme la
 * porte pour de bon : aucun appel ne peut plus se tromper de période.
 */
function moisCivil(date) {
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00Z`);
  const debut = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const fin = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { debut: debut.toISOString().slice(0, 10), fin: fin.toISOString().slice(0, 10) };
}

/** Passe tous les comptes clients en revue pour le mois contenant la période donnée. */
export async function runTenueCompteBatch({ periodStart, periodEnd }) {
  // Quoi que demande l'appelant, on facture le mois, et rien d'autre.
  const mois = moisCivil(periodStart ?? periodEnd ?? new Date().toISOString());
  periodStart = mois.debut;
  periodEnd = mois.fin;

  const { rows: fee } = await query(
    `SELECT * FROM current_fee_versions
     WHERE trigger_on = 'tenue_compte' AND status = 'actif'
     LIMIT 1`
  );

  if (!fee[0]) return { applied: 0, message: 'Aucun barème de frais de tenue actif.' };

  const { rows: accounts } = await query(
    `SELECT a.id FROM accounts a JOIN users u ON u.id = a.user_id WHERE u.role = 'client' AND u.status = 'actif'`
  );

  const results = [];
  for (const account of accounts) {
    try {
      const result = await runTenueCompteForAccount({
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
/**
 * Calcule et applique un frais déclenché (retrait, dépôt, déblocage de
 * crédit...). Accepte un `client` de transaction déjà ouvert — pour un
 * déblocage de crédit notamment, le prélèvement des frais doit réussir
 * ou échouer avec le même geste que le crédit du compte : jamais l'un
 * sans l'autre. Sans client fourni, ouvre sa propre transaction (usage
 * autonome, ex. lors d'un retrait au guichet).
 */
export async function applyTriggeredFee({ accountId, triggerOn, operationAmount, client: externalClient }) {
  const runner = externalClient ?? { query: query };

  const { rows } = await runner.query(
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

  const apply = async (client) => {
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
  };

  return externalClient ? apply(externalClient) : withTransaction(apply);
}

/* ═══════════════════════════════════════════════════════════════════
   FRAIS PRÉLEVÉS PONCTUELLEMENT SUR UN SEUL COMPTE
   ═══════════════════════════════════════════════════════════════════

   « Il faut que l'opérateur ait la possibilité de retirer les frais de
     tenue de compte ou agios ponctuellement à un client si elle
     constate que cela n'a pas été fait par le logiciel. »

   Le besoin est réel : des agents crédités après le passage du 25 — ou
   créés entre deux passages — sont restés sans frais prélevés, et la
   caisse l'a signalé plusieurs fois (BOUBANDA, MAPAGA, les agents
   SOBAMA/QSR/STVB d'octobre).

   Trois garde-fous, tous déjà portés par le code existant et
   délibérément NON réécrits ici :

     • le montant n'est jamais saisi à la main. Il vient du barème en
       vigueur, exactement comme pour le prélèvement automatique. Une
       opératrice ne peut pas inventer un frais de 50 000 F.

     • le double prélèvement est impossible : runTenueCompteForAccount
       et runAgiosForAccount s'appuient sur la contrainte d'unicité de
       applied_fees et remontent « deja_preleve ». On le vérifie AUSSI
       dès la demande, pour que l'opératrice l'apprenne tout de suite
       au lieu d'attendre le refus du directeur.

     • le solde n'est pas vérifié, et c'est voulu : un frais est dû dès
       qu'il est constaté. C'est la seule dette qui peut mettre un
       compte au rouge (règle de la direction : « il ne doit y avoir
       que le négatif des frais de tenue de compte »).

   Rien n'est prélevé sur la seule initiative de l'opératrice : la
   demande attend la validation du directeur, comme un retrait
   ponctuel. */

/**
 * Chaque nature correspond à un barème réel du catalogue. Les valeurs
 * sont celles que le prélèvement automatique interroge (voir
 * runTenueCompteBatch et runAgiosBatch) : « solde_debiteur » et non
 * « agios », qui n'existe pas comme déclencheur.
 */
const DECLENCHEUR_PAR_NATURE = {
  frais_tenue: 'tenue_compte',
  agios: 'solde_debiteur',
};

/** Ramène « 2026-10 » au premier et au dernier jour du mois. */
function moisDepuisPeriode(periode) {
  const [annee, mois] = String(periode).split('-').map(Number);
  const debut = new Date(Date.UTC(annee, mois - 1, 1));
  const fin = new Date(Date.UTC(annee, mois, 0));
  return { debut: debut.toISOString().slice(0, 10), fin: fin.toISOString().slice(0, 10) };
}

/** Le barème actif pour cette nature de frais, ou null s'il n'y en a pas. */
async function baremeActifPour(nature) {
  const declencheur = DECLENCHEUR_PAR_NATURE[nature];
  if (!declencheur) return null;
  const { rows } = await query(
    `SELECT * FROM current_fee_versions
     WHERE trigger_on = $1 AND status = 'actif'
     LIMIT 1`,
    [declencheur]
  );
  return rows[0] ?? null;
}

/**
 * Ce frais a-t-il déjà été prélevé sur ce compte pour ce mois ?
 *
 * On ignore volontairement la version du barème, alors que la
 * contrainte d'unicité de applied_fees la prend en compte : un
 * changement de barème ne doit pas ouvrir la porte à un second
 * prélèvement du même mois.
 */
async function dejaPreleveCeMois({ accountId, nature, periodStart, periodEnd }) {
  const { rows } = await query(
    `SELECT af.amount, af.created_at
     FROM applied_fees af
     JOIN fee_versions v ON v.id = af.fee_version_id
     JOIN fee_definitions f ON f.id = v.fee_id
     WHERE af.account_id = $1 AND f.trigger_on = $2
       AND af.period_start = $3 AND af.period_end = $4
     LIMIT 1`,
    [accountId, DECLENCHEUR_PAR_NATURE[nature], periodStart, periodEnd]
  );
  return rows[0] ?? null;
}

/**
 * Aperçu : combien serait prélevé, et est-ce déjà fait — sans rien
 * écrire. Sert à l'opératrice au moment de la demande, puis au
 * directeur qui voit le montant avant de valider.
 */
export async function previewFraisPonctuel({ accountId, nature, periode }) {
  const bareme = await baremeActifPour(nature);
  if (!bareme) {
    throw new RateError(
      nature === 'agios'
        ? "Aucun barème d'agios actif : la direction doit l'activer dans Catalogue avant tout prélèvement."
        : 'Aucun barème de frais de tenue actif : la direction doit l’activer dans Catalogue.',
      'bareme_absent'
    );
  }

  const { debut: periodStart, fin: periodEnd } = moisDepuisPeriode(periode);
  const deja = await dejaPreleveCeMois({ accountId, nature, periodStart, periodEnd });

  let amount = 0;
  let detail = {};

  if (nature === 'frais_tenue') {
    amount = computeFee({
      basis: bareme.basis,
      amount: Number(bareme.amount),
      rate: Number(bareme.rate),
      minAmount: Number(bareme.min_amount ?? 0),
      maxAmount: bareme.max_amount === null ? null : Number(bareme.max_amount),
    });
  } else {
    // Agios : le montant dépend des soldes jour par jour sur le mois.
    // Mêmes lectures et mêmes calculs que runAgiosForAccount, mais sans
    // la moindre écriture.
    const { rows: opening } = await query(
      `SELECT COALESCE(SUM(amount), 0) AS balance
       FROM ledger_entries WHERE account_id = $1 AND created_at < $2`,
      [accountId, periodStart]
    );
    const { rows: entries } = await query(
      `SELECT created_at, amount FROM ledger_entries
       WHERE account_id = $1 AND created_at >= $2 AND created_at < ($3::date + 1)
       ORDER BY created_at`,
      [accountId, periodStart, periodEnd]
    );
    const resultat = computeAgios(
      buildDailyBalances(Number(opening[0].balance), entries, periodStart, periodEnd),
      {
        rate: Number(bareme.rate),
        minAmount: Number(bareme.min_amount ?? 0),
        maxAmount: bareme.max_amount === null ? null : Number(bareme.max_amount),
        exemptBelow: Number(bareme.exempt_below ?? 0),
      }
    );
    amount = resultat.amount;
    detail = { joursDebiteurs: resultat.debitDays };
  }

  return {
    nature,
    periodStart,
    periodEnd,
    montant: amount,
    bareme: bareme.name,
    dejaPreleve: deja
      ? { montant: Number(deja.amount), le: deja.created_at }
      : null,
    detail,
  };
}

/**
 * Prélève réellement. Appelé à la validation du directeur, jamais
 * avant. Délègue aux fonctions du prélèvement automatique pour que la
 * règle reste écrite à un seul endroit.
 */
export async function appliquerFraisPonctuel({ accountId, nature, periode, client }) {
  const bareme = await baremeActifPour(nature);
  if (!bareme) {
    throw new RateError('Le barème de ce frais n’est plus actif — prélèvement impossible.', 'bareme_absent');
  }
  const { debut: periodStart, fin: periodEnd } = moisDepuisPeriode(periode);

  const resultat = nature === 'frais_tenue'
    ? await runTenueCompteForAccount({ accountId, periodStart, periodEnd, feeVersion: bareme, client })
    : await runAgiosForAccount({ accountId, periodStart, periodEnd, feeVersion: bareme, client });

  if (!resultat.amount || resultat.amount <= 0) {
    throw new RateError(
      nature === 'agios'
        ? 'Aucun agio dû sur ce mois : le compte n’est pas resté débiteur.'
        : 'Le barème donne un montant nul — rien à prélever.',
      'montant_nul'
    );
  }
  return resultat;
}
