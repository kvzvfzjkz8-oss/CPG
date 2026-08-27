import pg from 'pg';
import { config } from '../config.js';

// Le type BIGINT (OID 20) est renvoyé en chaîne par défaut, car il peut
// dépasser Number.MAX_SAFE_INTEGER. Nos montants en FCFA restent très
// en dessous, donc on les convertit en nombre pour simplifier l'API JSON.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30000,
  // SSL exigé uniquement si explicitement demandé (DATABASE_SSL=true) :
  // beaucoup d'hébergeurs gérés (Railway notamment) exposent leur base
  // via une connexion interne qui ne supporte pas le SSL strict, et
  // l'ancien réglage « toujours en production » cassait le démarrage
  // dans ce cas précis.
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
});

export const query = (text, params) => pool.query(text, params);

/**
 * Exécute une suite de requêtes dans une transaction.
 * Indispensable dès qu'une opération touche plusieurs tables :
 * débiter un compte et marquer une échéance payée doivent réussir
 * ou échouer ensemble, jamais à moitié.
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
