/**
 * ═══════════════════════════════════════════════════════════════════
 *  ENVELOPPE D'UNE SÉANCE DE COMMISSION
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Chaque commission doit avoir un montant plafonné donné par le
 *   directeur. Ce montant peut être dépassé tant que la commission n'a
 *   pas été tenue, mais durant la tenue de la séance les noms et les
 *   montants qui vont être validés ne doivent pas dépasser ce montant. »
 *
 * Deux régimes, et les tests portent exactement sur la frontière entre
 * les deux :
 *
 *   • au DÉPÔT, le dépassement est permis et seulement signalé ;
 *   • en SÉANCE, il est refusé, en bloc, avant la moindre écriture.
 *
 * Et une propriété qui compte autant que la limite elle-même : un
 * dossier écarté faute d'enveloppe n'est pas perdu. Il se retire de la
 * file et redevient disponible pour une séance suivante.
 *
 * Fichier séparé : src/app.js plafonne à 120 requêtes par minute et
 * node --test lance un processus par fichier.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, api, loginStaff, hasTestDatabase,
} from '../helpers/testServer.js';

let gestionnaireToken;
let directeurToken;
let operateurToken;
let produitId;

before(async () => {
  await startTestServer();
  if (!hasTestDatabase()) return;
  gestionnaireToken = await loginStaff('gestionnaire');
  directeurToken = await loginStaff('directeur');
  operateurToken = await loginStaff('operateur');
  const { body } = await api('/v1/admin/catalogue/produits/actifs', { token: gestionnaireToken });
  produitId = body.produits.find((p) => p.code === 'MICRO_STD').product_id;
});

after(async () => {
  if (!hasTestDatabase()) { await stopTestServer(); return; }
  // Ne pas laisser de séance « planifiee » derrière soi : commission.test.js
  // exige qu'il n'y en ait aucune au démarrage, et les fichiers partagent
  // une seule base.
  // Retirer les dossiers AVANT d'annuler la séance : une séance annulée
  // qui en contient encore les laisse à « en_attente_commission »
  // rattachés à une séance morte, invisibles et gênants pour les
  // fichiers suivants, qui partagent la même base.
  const { body } = await api('/v1/admin/commission/seance', { token: gestionnaireToken });
  if (body?.seance?.id) {
    const { body: file } = await api(`/v1/admin/commission/file-attente/${body.seance.id}`, {
      token: gestionnaireToken,
    });
    for (const d of file?.dossiers ?? []) {
      await api(`/v1/admin/commission/credits/${d.id}/retirer`, {
        method: 'POST', token: gestionnaireToken,
      });
    }
    await api(`/v1/admin/commission/seance/${body.seance.id}`, {
      method: 'DELETE', token: gestionnaireToken,
    });
  }
  await stopTestServer();
});

/** Un dossier amené jusqu'à « valide_niveau1 », prêt à être déposé. */
async function dossierPret(label, montant) {
  const phone = `+24106${String(Math.floor(Math.random() * 900000) + 100000)}`;
  await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: {
      nomComplet: `Client Plafond ${label}`, telephone: phone, role: 'client', codePin: '1234',
      // Les noms de ces clients de test se ressemblent par
      // construction : sans cette confirmation, le garde-fou
      // anti-doublon les refuse (409).
      confirmerDoublon: true,
    },
  });
  const { body: s } = await api('/v1/auth/connexion-client', {
    method: 'POST', body: { phone, pin: '1234' },
  });
  const { body: cree } = await api('/v1/client/credits', {
    method: 'POST', token: s.accessToken,
    body: { produitId, montant, duree: 4, motif: `Test plafond ${label}` },
  });
  await api(`/v1/admin/credits/${cree.id}/valider-niveau1`, { method: 'POST', token: operateurToken });
  return { id: cree.id, reference: cree.reference, montant };
}

async function programmerSeance() {
  const { body: existante } = await api('/v1/admin/commission/seance', { token: gestionnaireToken });
  if (existante?.seance?.id) {
    await api(`/v1/admin/commission/seance/${existante.seance.id}`, {
      method: 'DELETE', token: gestionnaireToken,
    });
  }
  const demain = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
  const { body } = await api('/v1/admin/commission/seance', {
    method: 'POST', token: gestionnaireToken, body: { dateHeure: demain },
  });
  return body.id;
}

const enveloppe = async (id) => {
  const { body } = await api(`/v1/admin/commission/seance/${id}/enveloppe`, { token: directeurToken });
  return body;
};

describe(
  'Enveloppe d’une séance de commission',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('le gestionnaire ne peut pas fixer l’enveloppe', async () => {
      const sessionId = await programmerSeance();
      const { status } = await api(`/v1/admin/commission/seance/${sessionId}/plafond`, {
        method: 'PATCH', token: gestionnaireToken, body: { plafond: 5000000 },
      });
      assert.equal(status, 403, 'l’enveloppe est une décision du directeur');
    });

    test('le gestionnaire ne peut pas non plus la glisser à la programmation', async () => {
      const { body: existante } = await api('/v1/admin/commission/seance', { token: gestionnaireToken });
      if (existante?.seance?.id) {
        await api(`/v1/admin/commission/seance/${existante.seance.id}`, {
          method: 'DELETE', token: gestionnaireToken,
        });
      }
      const demain = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
      const { status } = await api('/v1/admin/commission/seance', {
        method: 'POST', token: gestionnaireToken,
        body: { dateHeure: demain, plafond: 9000000 },
      });
      assert.equal(status, 403);
    });

    test('le directeur fixe l’enveloppe, et elle est immédiatement lisible', async () => {
      const sessionId = await programmerSeance();
      const { status } = await api(`/v1/admin/commission/seance/${sessionId}/plafond`, {
        method: 'PATCH', token: directeurToken, body: { plafond: 300000 },
      });
      assert.equal(status, 200);

      const e = await enveloppe(sessionId);
      assert.equal(e.plafond, 300000);
      assert.equal(e.depose, 0);
      assert.equal(e.reste, 300000);
      assert.equal(e.depassement, 0);
    });

    test('un plafond nul ou négatif est refusé', async () => {
      const sessionId = await programmerSeance();
      for (const plafond of [0, -1000]) {
        const { status } = await api(`/v1/admin/commission/seance/${sessionId}/plafond`, {
          method: 'PATCH', token: directeurToken, body: { plafond },
        });
        assert.equal(status, 422, `plafond ${plafond} doit être refusé`);
      }
    });

    // Le dépôt ne bloque pas : déposer n'engage aucun franc.
    test('déposer au-delà de l’enveloppe est permis, et le dépassement est signalé', async () => {
      const sessionId = await programmerSeance();
      await api(`/v1/admin/commission/seance/${sessionId}/plafond`, {
        method: 'PATCH', token: directeurToken, body: { plafond: 100000 },
      });

      const a = await dossierPret('A', 80000);
      const b = await dossierPret('B', 80000);
      for (const d of [a, b]) {
        const { status } = await api(`/v1/admin/commission/credits/${d.id}/deposer`, {
          method: 'POST', token: gestionnaireToken,
        });
        assert.equal(status, 201, 'le dépôt ne doit jamais être bloqué par l’enveloppe');
      }

      const e = await enveloppe(sessionId);
      assert.equal(e.depose, 160000);
      assert.equal(e.reste, -60000, 'le reste devient négatif, c’est le signal');
      assert.equal(e.depassement, 60000);
      assert.equal(e.dossiersDeposes, 2);
    });

    // LE test : la limite s'applique au moment où les octrois deviennent réels.
    test('valider en séance au-delà de l’enveloppe est refusé, en bloc', async () => {
      const sessionId = await programmerSeance();
      await api(`/v1/admin/commission/seance/${sessionId}/plafond`, {
        method: 'PATCH', token: directeurToken, body: { plafond: 100000 },
      });
      const a = await dossierPret('C', 80000);
      const b = await dossierPret('D', 80000);
      for (const d of [a, b]) {
        await api(`/v1/admin/commission/credits/${d.id}/deposer`, {
          method: 'POST', token: gestionnaireToken,
        });
      }

      const { status, body } = await api(`/v1/admin/commission/seance/${sessionId}/tenir`, {
        method: 'POST', token: directeurToken,
        body: {
          decisions: [
            { kind: 'credit', creditId: a.id, decision: 'valide' },
            { kind: 'credit', creditId: b.id, decision: 'valide' },
          ],
        },
      });

      assert.equal(status, 422);
      assert.match(body.error, /enveloppe/i);
      assert.match(body.error, /60000/, 'l’excédent exact doit être dit');
      assert.match(body.error, /Client Plafond/, 'les dossiers concernés doivent être nommés');

      // Rien ne doit avoir bougé : la séance reste à tenir.
      const { body: seance } = await api('/v1/admin/commission/seance', { token: directeurToken });
      assert.equal(seance.seance.id, sessionId, 'la séance ne doit pas avoir été tenue');
      const e = await enveloppe(sessionId);
      assert.equal(e.valide, 0, 'aucun dossier ne doit être passé en valide_commission');
    });

    test('rejeter l’excédent fait passer la séance', async () => {
      const sessionId = await programmerSeance();
      await api(`/v1/admin/commission/seance/${sessionId}/plafond`, {
        method: 'PATCH', token: directeurToken, body: { plafond: 100000 },
      });
      const a = await dossierPret('E', 80000);
      const b = await dossierPret('F', 80000);
      for (const d of [a, b]) {
        await api(`/v1/admin/commission/credits/${d.id}/deposer`, {
          method: 'POST', token: gestionnaireToken,
        });
      }

      const { status } = await api(`/v1/admin/commission/seance/${sessionId}/tenir`, {
        method: 'POST', token: directeurToken,
        body: {
          decisions: [
            { kind: 'credit', creditId: a.id, decision: 'valide' },
            { kind: 'credit', creditId: b.id, decision: 'rejete' },
          ],
        },
      });
      assert.equal(status, 200, '80 000 F validés sous une enveloppe de 100 000 F doivent passer');
    });

    // Ce qui dépasse n'est pas perdu : on le retire de la file.
    test('retirer un dossier de la file libère l’enveloppe et il reste réutilisable', async () => {
      const sessionId = await programmerSeance();
      await api(`/v1/admin/commission/seance/${sessionId}/plafond`, {
        method: 'PATCH', token: directeurToken, body: { plafond: 100000 },
      });
      const a = await dossierPret('G', 80000);
      const b = await dossierPret('H', 80000);
      for (const d of [a, b]) {
        await api(`/v1/admin/commission/credits/${d.id}/deposer`, {
          method: 'POST', token: gestionnaireToken,
        });
      }

      const { status: retire } = await api(`/v1/admin/commission/credits/${b.id}/retirer`, {
        method: 'POST', token: gestionnaireToken,
      });
      assert.equal(retire, 200);

      const e = await enveloppe(sessionId);
      assert.equal(e.depose, 80000, 'l’enveloppe se libère du montant retiré');
      assert.equal(e.depassement, 0);

      const { status } = await api(`/v1/admin/commission/seance/${sessionId}/tenir`, {
        method: 'POST', token: directeurToken,
        body: { decisions: [{ kind: 'credit', creditId: a.id, decision: 'valide' }] },
      });
      assert.equal(status, 200);

      // Le dossier retiré est revenu disponible, pas perdu.
      const { body: dispo } = await api('/v1/admin/credits?statut=valide_niveau1&limite=500', {
        token: gestionnaireToken,
      });
      assert.ok(
        dispo.credits.some((c) => c.id === b.id),
        'le dossier retiré doit être redevenu déposable pour une prochaine séance'
      );
    });

    test('une séance sans enveloppe ne bloque rien', async () => {
      const sessionId = await programmerSeance();
      const a = await dossierPret('I', 400000);
      await api(`/v1/admin/commission/credits/${a.id}/deposer`, {
        method: 'POST', token: gestionnaireToken,
      });
      const e = await enveloppe(sessionId);
      assert.equal(e.plafond, null);
      assert.equal(e.reste, null);

      const { status } = await api(`/v1/admin/commission/seance/${sessionId}/tenir`, {
        method: 'POST', token: directeurToken,
        body: { decisions: [{ kind: 'credit', creditId: a.id, decision: 'valide' }] },
      });
      assert.equal(status, 200, 'sans enveloppe fixée, l’ancien comportement reste');
    });

    test('l’enveloppe d’une séance tenue ne peut plus changer', async () => {
      const sessionId = await programmerSeance();
      await api(`/v1/admin/commission/seance/${sessionId}/plafond`, {
        method: 'PATCH', token: directeurToken, body: { plafond: 500000 },
      });
      const a = await dossierPret('J', 60000);
      await api(`/v1/admin/commission/credits/${a.id}/deposer`, {
        method: 'POST', token: gestionnaireToken,
      });
      await api(`/v1/admin/commission/seance/${sessionId}/tenir`, {
        method: 'POST', token: directeurToken,
        body: { decisions: [{ kind: 'credit', creditId: a.id, decision: 'valide' }] },
      });

      const { status } = await api(`/v1/admin/commission/seance/${sessionId}/plafond`, {
        method: 'PATCH', token: directeurToken, body: { plafond: 900000 },
      });
      assert.equal(status, 409, 'l’enveloppe d’une séance tenue est la trace de ce qui a autorisé les octrois');
    });
  }
);
