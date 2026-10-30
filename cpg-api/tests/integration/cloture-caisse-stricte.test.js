/**
 * ═══════════════════════════════════════════════════════════════════
 *  LE RENVOI DE 15H30 N'EST PLUS UN BOUTON
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Il faut que le renvoi de l'argent à partir de 15H30 soit assez
 *   strict. Je constate qu'il y a des fois où l'argent reste encore
 *   dans la caisse. »
 *
 * Au 27/10/2026, 15 journées d'activité sur 23 n'avaient jamais été
 * clôturées — jusqu'à 26 174 607 F dormant au guichet le 07/10. La
 * clôture dépendait d'un clic.
 *
 * Ces tests portent sur le balayage qui la remplace : il clôture les
 * caisses oubliées, ne laisse que le fonds de caisse, et — le point
 * qui compte autant — ne repasse pas deux fois sur la même somme.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, api, loginStaff, hasTestDatabase, fundCaissePrincipale,
} from '../helpers/testServer.js';
import { MONTANT_BASE_CAISSE } from '../../src/services/clotureCaisseService.js';

let directeurToken;
let gestionnaireToken;
let caissierToken;
let caissierId;

const FONDS = MONTANT_BASE_CAISSE;

before(async () => {
  await startTestServer();
  if (!hasTestDatabase()) return;
  directeurToken = await loginStaff('directeur');
  gestionnaireToken = await loginStaff('gestionnaire');

  const email = `caissiere.cloture.${Date.now()}@cpg.ga`;
  const tel = `+24105${String(Math.floor(Math.random() * 900000) + 100000)}`;
  const { body } = await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: {
      // Nom unique au fichier : un homonyme exact ne peut être confirmé
      // que par le directeur, et c'est le gestionnaire qui crée ici.
      nomComplet: `Caissière Cloture Stricte ${Date.now()}`,
      telephone: tel, email, role: 'caissier',
      motDePasse: 'MotDePasseDemo2026!', confirmerDoublon: true,
    },
  });
  caissierId = body.id;
  caissierToken = await loginStaff(email);
  await fundCaissePrincipale(20000000);
});

after(async () => {
  await stopTestServer();
});

/** Approvisionne la caisse de notre caissière et fait valider l'appro. */
async function approvisionner(montant) {
  const { body } = await api('/v1/caisse/appro', {
    method: 'POST', token: caissierToken, body: { montant, motif: 'Test clôture' },
  });
  const { status } = await api(`/v1/caisse/operations/${body.id}/valider`, {
    method: 'POST', token: directeurToken,
  });
  assert.equal(status, 200, 'l’appro doit être validé');
}

const maCaisse = async () => {
  const { body } = await api('/v1/caisse/ma-caisse', { token: caissierToken });
  return Number(body.solde);
};

const clotureDuJour = async () => {
  const { body } = await api('/v1/caisse/cloture-du-jour', { token: caissierToken });
  return body.cloture;
};

const balayer = () => api('/v1/caisse/excedents/renvoyer', {
  method: 'POST', token: directeurToken,
});

describe(
  'Renvoi strict des excédents de caisse',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('une caisse chargée et non clôturée est ramenée au fonds de caisse', async () => {
      await approvisionner(3000000);
      assert.equal(await maCaisse(), 3000000, 'la caisse doit porter l’appro');

      const { status } = await balayer();
      assert.equal(status, 200);

      assert.equal(
        await maCaisse(), FONDS,
        'il ne doit rester que le fonds de caisse — c’est tout l’objet de la demande'
      );

      const cloture = await clotureDuJour();
      assert.ok(cloture, 'la journée doit être enregistrée comme clôturée');
      assert.equal(cloture.automatique, true, 'et marquée comme faite par le logiciel');
      assert.equal(Number(cloture.excedent_renvoye), 3000000 - FONDS);
    });

    test('repasser ne renvoie rien de plus', async () => {
      // Le piège d'un balayage : rejouer et débiter deux fois. Ici le
      // solde est déjà au fonds de caisse, il n'y a plus d'excédent.
      const { body } = await balayer();
      assert.equal(Number(body.renvoye), 0);
      assert.equal(await maCaisse(), FONDS);
    });

    test('la caissière ne peut plus clôturer une journée déjà clôturée', async () => {
      const { status, body } = await api('/v1/caisse/clore', {
        method: 'POST', token: caissierToken,
      });
      assert.equal(status, 409, 'une seule clôture par jour, tenue en base');
      assert.match(body.error, /déjà été clôturée/i);
    });

    test('l’argent entré après la clôture repart aussi', async () => {
      // Le cas réel du 23/10 : deux appros de 5 588 000 F validés à
      // 15h47, trente minutes après la clôture de 15h15. Sans second
      // passage, ils passaient la nuit au guichet.
      await approvisionner(1500000);
      assert.equal(await maCaisse(), FONDS + 1500000);

      const { body } = await balayer();
      assert.ok(Number(body.renvoye) >= 1500000, 'le nouvel excédent doit être renvoyé');
      assert.equal(await maCaisse(), FONDS);

      const cloture = await clotureDuJour();
      assert.equal(
        Number(cloture.excedent_renvoye), 3000000 - FONDS,
        'la clôture du jour reste unique et garde ce qu’elle avait renvoyé ; '
        + 'le rattrapage vit dans le journal de caisse, avec son motif'
      );
    });

    test('le renvoi est réservé au directeur', async () => {
      const { status: parCaissiere } = await api('/v1/caisse/excedents/renvoyer', {
        method: 'POST', token: caissierToken,
      });
      assert.equal(parCaissiere, 403, 'ce n’est pas à la caissière de décider');

      const { status: parGestionnaire } = await api('/v1/caisse/excedents/renvoyer', {
        method: 'POST', token: gestionnaireToken,
      });
      assert.equal(parGestionnaire, 403);
    });

    test('le retour d’excédent apparaît au journal de la caissière', async () => {
      const { body } = await api('/v1/caisse/mes-operations', { token: caissierToken });
      const retours = (body.operations ?? body).filter((o) => o.type === 'retour_excedent');
      assert.ok(retours.length >= 2, 'les deux renvois doivent être tracés');
      assert.ok(
        retours.some((o) => /15h30|soir|directeur/i.test(o.motif ?? '')),
        'le motif doit dire d’où vient le renvoi, pas seulement qu’il a eu lieu'
      );
    });
  }
);
