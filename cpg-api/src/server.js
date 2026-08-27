import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db/index.js';
import { startScheduler } from './jobs/scheduler.js';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`CPG API démarrée sur le port ${config.port} (${config.env})`);
  startScheduler();
});

/**
 * Arrêt propre : on cesse d'accepter de nouvelles requêtes, on laisse
 * les requêtes en cours se terminer, puis on ferme la base. Sans cela,
 * un redéploiement peut interrompre une transaction en plein milieu.
 */
async function shutdown(signal) {
  console.log(`${signal} reçu, arrêt en cours…`);
  server.close(async () => {
    await pool.end();
    console.log('Arrêt terminé.');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Arrêt forcé après délai.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
