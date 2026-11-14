/**
 * ═══════════════════════════════════════════════════════════════════
 *  PARTICULIER OU ENTREPRISE — DEUX BARÈMES DE FRAIS DE TENUE
 * ═══════════════════════════════════════════════════════════════════
 *
 * « C'est bien de différencier une entreprise d'un particulier car les
 *   frais de tenue ne sont pas les mêmes mais plus élevés. »
 *   « Oui je valide pour la fiche client (particulier ou entreprise) et
 *   oui un second barème frais de tenue entreprise (15 000 F). »
 *   (direction, 14/11/2026)
 *
 * Ce que ce fichier protège : qu'un particulier ne se fasse jamais
 * prélever le tarif entreprise, et l'inverse. Les deux barèmes portent
 * le MÊME déclencheur `tenue_compte` ; avant cette série, le service
 * prenait « le premier actif », c'est-à-dire au hasard selon l'ordre de
 * la table.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { query } from '../../src/db/index.js';
import {
  startTestServer, stopTestServer, api, loginStaff, hasTestDatabase,
} from '../helpers/testServer.js';

before(async () => { await startTestServer(); });
after(async () => { await stopTestServer(); });

const unique = Date.now();

/** Le frais de tenue réellement prélevé sur ce client ce mois-ci. */
const fraisPreleves = (userId) => query(
  `SELECT af.amount::bigint AS montant, f.code
   FROM applied_fees af
   JOIN fee_versions v ON v.id = af.fee_version_id
   JOIN fee_definitions f ON f.id = v.fee_id
   JOIN accounts a ON a.id = af.account_id
   WHERE a.user_id = $1 AND f.trigger_on = 'tenue_compte'
   ORDER BY af.created_at DESC`,
  [userId]
).then((r) => r.rows);

// Un compteur, et non la longueur du nom : « Defaut Particulier » et
// « Devient Entreprise » font la meme longueur, fabriquaient le meme
// numero, et la seconde creation echouait en silence — le test partait
// alors sur un identifiant vide.
let suivant = 0;

async function creerClient(nom, typeClient) {
  const directeur = await loginStaff('directeur');
  const telephone = `+2410${String(unique).slice(-6)}${String(suivant++).padStart(2, '0')}`;
  const { status, body } = await api('/v1/admin/utilisateurs', {
    method: 'POST', token: directeur,
    body: {
      nomComplet: nom,
      telephone,
      role: 'client', codePin: '1234', employeur: 'CPG',
      ...(typeClient ? { typeClient } : {}),
    },
  });
  assert.equal(status, 201, `création de « ${nom} » : ${JSON.stringify(body)}`);
  return body;
}

describe(
  'Frais de tenue — particulier et entreprise',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('les deux barèmes coexistent, et ils diffèrent', async () => {
      const { rows } = await query(
        `SELECT f.code, v.amount::bigint AS montant
         FROM fee_definitions f JOIN fee_versions v ON v.fee_id = f.id
         WHERE f.trigger_on = 'tenue_compte' AND v.effective_to IS NULL AND f.status = 'actif'
         ORDER BY f.code`
      );
      const codes = rows.map((r) => r.code);
      assert.ok(codes.includes('FRAIS_TENUE'), 'le barème des particuliers doit exister');
      assert.ok(codes.includes('FRAIS_TENUE_ENTREPRISE'), 'celui des entreprises aussi');

      const entreprise = rows.find((r) => r.code === 'FRAIS_TENUE_ENTREPRISE');
      const particulier = rows.find((r) => r.code === 'FRAIS_TENUE');
      assert.ok(
        Number(entreprise.montant) > Number(particulier.montant),
        `celui des entreprises doit être plus élevé : ${entreprise.montant} contre ${particulier.montant}`
      );
    });

    test('un client est particulier par défaut', async () => {
      const c = await creerClient(`Defaut Particulier ${unique}`);
      const { rows } = await query('SELECT type_client::text AS t FROM users WHERE id = $1', [c.id]);
      assert.equal(rows[0].t, 'particulier');
    });

    test('chacun paie son barème, et pas celui de l’autre', async () => {
      const part = await creerClient(`Tenue Particulier ${unique}`, 'particulier');
      const entr = await creerClient(`Tenue Entreprise ${unique}`, 'entreprise');

      const { status } = await api('/v1/admin/catalogue/tenue-compte/executer', {
        method: 'POST', token: await loginStaff('directeur'),
        body: {
          debut: new Date().toISOString().slice(0, 8) + '01',
          fin: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)
            .toISOString().slice(0, 10),
        },
      });
      assert.equal(status, 200, 'le prélèvement mensuel doit passer');

      const [fPart] = await fraisPreleves(part.id);
      const [fEntr] = await fraisPreleves(entr.id);
      assert.ok(fPart, 'le particulier doit avoir été prélevé');
      assert.ok(fEntr, 'l’entreprise aussi');

      assert.equal(fPart.code, 'FRAIS_TENUE', 'le particulier paie le barème des particuliers');
      assert.equal(fEntr.code, 'FRAIS_TENUE_ENTREPRISE', 'l’entreprise paie le sien');
      assert.ok(
        Number(fEntr.montant) > Number(fPart.montant),
        `l’entreprise doit payer davantage : ${fEntr.montant} contre ${fPart.montant}`
      );
    });

    test('le type se change après coup, et le barème suit', async () => {
      const c = await creerClient(`Devient Entreprise ${unique}`, 'particulier');
      const directeur = await loginStaff('directeur');

      const { status } = await api(`/v1/admin/utilisateurs/${c.id}`, {
        method: 'PATCH', token: directeur, body: { typeClient: 'entreprise' },
      });
      assert.equal(status, 200);

      const { rows } = await query('SELECT type_client::text AS t FROM users WHERE id = $1', [c.id]);
      assert.equal(rows[0].t, 'entreprise');
    });

    test('un agent ne peut pas être une entreprise', async () => {
      // La base l'impose (type_client_reserve_aux_clients), pas
      // seulement l'API : un opérateur n'est pas une personne morale.
      await assert.rejects(
        () => query(
          `UPDATE users SET type_client = 'entreprise'
           WHERE role = 'operateur' AND id = (SELECT id FROM users WHERE role = 'operateur' LIMIT 1)`
        ),
        /type_client_reserve_aux_clients/,
        'la contrainte doit refuser'
      );
    });
  }
);
