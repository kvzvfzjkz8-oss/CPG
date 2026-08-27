import cron from 'node-cron';
import { query } from '../db/index.js';
import { runInstallmentCollection } from '../services/operationsService.js';
import { runAgiosBatch } from '../services/feeService.js';
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

  console.log('Tâches planifiées démarrées : échéances (quotidien, 6h) · agios (le 30, 3h).');
}

// Exportées pour permettre un déclenchement manuel de secours (route
// /admin/operations/echeances/executer et l'équivalent agios déjà en
// place) sans dupliquer la logique de résolution de l'acteur système.
export { collectInstallments, collectAgios, getSystemActor };
