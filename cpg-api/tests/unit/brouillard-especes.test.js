/**
 * ═══════════════════════════════════════════════════════════════════
 *  LE BROUILLARD NE COMPTE QUE LE TIROIR
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Elle dit ne plus pouvoir effectuer de décaissement malgré le fait
 *   que sa caisse soit positive. Mais quand je télécharge le brouillard
 *   de vendredi je constate un solde négatif. »
 *
 * Les deux chiffres étaient vrais chacun de son côté : la caisse de
 * Ledry Joëlle BOUKANDOU tenait bien 4 201 700 F d'espèces au soir du
 * 23/10/2026, et son brouillard affichait −1 041 274 F. L'écart,
 * 5 242 974 F, c'était ses retraits Airtel — de l'argent sorti du
 * téléphone, jamais du tiroir.
 *
 * Le document savait le faire : `sortMobileMoney` existait. Mais la
 * requête du jour ne ramenait pas la colonne `mode_paiement`, donc le
 * test ne se déclenchait jamais, et le total Mobile Money du pied de
 * page restait à zéro. Ces tests figent les deux bouts : la règle, et
 * le fait qu'on lui donne de quoi s'appliquer.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calculerBrouillard } from '../../src/services/brouillardService.js';

// `montant` est un bigint en base : pg le renvoie en CHAÎNE. Les
// opérations sont écrites ici comme la base les rend, sans quoi le test
// ne vérifierait pas le cas réel.
const op = (type, montant, mode = 'especes', extra = {}) => ({
  type, montant: String(montant), mode_paiement: mode,
  demandee_le: '2026-10-23T14:00:00.000Z', client: 'Un client', ...extra,
});

describe('Brouillard de caisse — espèces et Mobile Money', () => {
  test('un retrait Mobile Money ne touche pas le solde d’espèces', () => {
    const { soldeCloture, totalMobileMoney } = calculerBrouillard({
      soldeOuverture: 1184594,
      operations: [op('retrait_client', 383500, 'airtel')],
    });
    assert.equal(soldeCloture, 1184594, 'le tiroir n’a rien versé');
    assert.equal(totalMobileMoney, 383500, 'mais la caissière l’a bien payé');
  });

  test('le total Mobile Money s’additionne — il ne se concatène pas', () => {
    // `totalMobileMoney += op.montant` sur des chaînes donnait
    // « 0383500214500 ». Le pied de page aurait affiché ce nombre-là.
    const { totalMobileMoney } = calculerBrouillard({
      soldeOuverture: 0,
      operations: [
        op('retrait_client', 383500, 'airtel'),
        op('retrait_client', 214500, 'airtel'),
      ],
    });
    assert.equal(totalMobileMoney, 598000);
    assert.equal(typeof totalMobileMoney, 'number');
  });

  test('la journée du 23/10 de Joëlle redonne les 4 201 700 F réels', () => {
    // Le cas exact, repris de la production : ouverture d'espèces,
    // les deux approvisionnements, et le mélange espèces / Airtel.
    const { soldeCloture, totalMobileMoney } = calculerBrouillard({
      soldeOuverture: 1184594,
      operations: [
        op('retrait_client', 492500),
        op('retour_excedent', 492094, 'especes', { client: null, motif: 'Clôture' }),
        op('appro', 5000000, 'especes', { client: null, motif: 'Réappro' }),
        op('appro', 588000, 'especes', { client: null, motif: 'Réappro' }),
        ...[390000, 214500, 146000, 234000, 292500, 146000, 243700, 292500,
          438700, 292500, 195000].map((m) => op('retrait_client', m, 'airtel')),
        op('retrait_client', 195000),
        ...[243700, 390000, 107000].map((m) => op('retrait_client', m, 'airtel')),
        op('retrait_client', 243700),
        op('retrait_client', 243700),
        op('retrait_client', 383500, 'airtel'),
        op('retrait_client', 487500),
        op('retrait_client', 243500),
        op('retrait_client', 107000),
        op('retrait_client', 65900),
      ],
    });
    assert.equal(soldeCloture, 4201700, 'c’est ce que la vue caisse_soldes donne');
    assert.equal(totalMobileMoney, 4009600, 'et voilà ce qui est sorti du téléphone');
  });

  test('sans mode_paiement, la règle ne peut pas s’appliquer', () => {
    // Le défaut d'origine, figé ici : si la requête cesse un jour de
    // ramener la colonne, ce test dit tout de suite ce qu'on perd.
    const { soldeCloture } = calculerBrouillard({
      soldeOuverture: 1184594,
      operations: [{ type: 'retrait_client', montant: '383500', demandee_le: '2026-10-23T14:00:00.000Z' }],
    });
    assert.equal(soldeCloture, 801094, 'le retrait est alors pris pour des espèces');
  });

  test('un frais ponctuel ne vide aucun tiroir', () => {
    const { soldeCloture } = calculerBrouillard({
      soldeOuverture: 200000,
      operations: [op('frais_ponctuel', 1000)],
    });
    assert.equal(soldeCloture, 200000);
  });
});
