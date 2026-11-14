/**
 * ═══════════════════════════════════════════════════════════════════
 *  LES DEUX TABLES DE PERMISSIONS NE DOIVENT PAS DIVERGER
 * ═══════════════════════════════════════════════════════════════════
 *
 * Les permissions sont écrites DEUX FOIS : côté serveur
 * (cpg-api/src/utils/permissions.js), qui autorise ou refuse, et côté
 * interface (cpg-admin/src/auth/roles.js), qui décide des onglets et
 * des boutons à afficher.
 *
 * Le 13/11/2026, le gestionnaire a déposé une demande de prélèvement
 * supplémentaire pour MOUNGUENGUI Wilfried. Elle s'est bien écrite en
 * base — mais ni l'opérateur ni le directeur n'ont rien vu : les
 * permissions du directeur avaient été posées côté serveur et oubliées
 * côté interface, si bien que son onglet ne s'affichait pas. La demande
 * est restée bloquée, invisible, et personne ne pouvait la faire
 * avancer.
 *
 * DEUX INVARIANTS, ET POURQUOI CEUX-LÀ
 *
 *   1. L'interface ne doit jamais accorder ce que le serveur refuse.
 *      Sinon elle affiche un bouton qui rend 403 — un piège, pas une
 *      information.
 *
 *   2. Les chaînes de validation doivent être complètes des deux
 *      côtés. Une chaîne à trois maillons dont un seul manque dans un
 *      fichier ne bloque pas une permission : elle fait disparaître
 *      un écran, ce qui ne se voit nulle part.
 *
 * L'inverse — le serveur accorde plus que l'interface — est normal :
 * le rôle client n'a aucun écran back-office, et certaines permissions
 * ne gardent que des routes.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERMISSIONS, ROLES } from '../../src/utils/permissions.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const ROLES_ADMIN = path.resolve(ICI, '../../../cpg-admin/src/auth/roles.js');

/**
 * Lit les permissions de l'interface par analyse du fichier. On ne
 * l'importe pas : c'est un module d'un autre paquet, écrit pour un
 * navigateur, et le lire suffit — on ne cherche ici qu'un ensemble de
 * chaînes de caractères.
 */
function permissionsDeLInterface() {
  const source = readFileSync(ROLES_ADMIN, 'utf8');
  const parRole = {};
  const blocs = source.split(/\[ROLES\.([A-Z]+)\]:\s*\[/);
  for (let i = 1; i < blocs.length; i += 2) {
    const role = blocs[i].toLowerCase();
    const corps = blocs[i + 1].split('\n  ],')[0];
    parRole[role] = new Set(corps.match(/'[a-z_]+\.[a-z_]+'/g)?.map((p) => p.slice(1, -1)) ?? []);
  }
  return parRole;
}

describe('Permissions — le serveur et l’interface', () => {
  const interfaceAdmin = permissionsDeLInterface();

  test('l’interface n’accorde jamais ce que le serveur refuse', () => {
    const fautes = [];
    for (const [role, accordees] of Object.entries(interfaceAdmin)) {
      const serveur = PERMISSIONS[role];
      if (!serveur) {
        fautes.push(`le rôle « ${role} » existe dans l’interface mais pas sur le serveur`);
        continue;
      }
      for (const p of accordees) {
        if (!serveur.includes(p)) {
          fautes.push(`${role} : l’interface accorde « ${p} », le serveur non — le bouton rendra 403`);
        }
      }
    }
    assert.deepEqual(fautes, [], `\n  ${fautes.join('\n  ')}\n`);
  });

  test('la chaîne de la gestion des crédits est complète des deux côtés', () => {
    // Trois maillons, trois rôles, et personne ne tient deux maillons :
    // c'est ce qui fait qu'aucune modification ne passe sans trois
    // signatures. `lire` accompagne les trois, sinon l'écran n'existe
    // pas pour celui qui doit agir.
    const chaine = {
      [ROLES.SUPERVISEUR]: 'credits.proposer_modification',
      [ROLES.OPERATEUR]: 'credits.accorder_modification',
      [ROLES.DIRECTEUR]: 'credits.decider_modification',
    };

    for (const [role, maillon] of Object.entries(chaine)) {
      assert.ok(
        PERMISSIONS[role].includes(maillon),
        `le serveur doit accorder « ${maillon} » à ${role}`
      );
      assert.ok(
        interfaceAdmin[role]?.has(maillon),
        `l’interface doit accorder « ${maillon} » à ${role} — sans quoi son écran n’existe pas`
      );
      assert.ok(
        PERMISSIONS[role].includes('credits.lire_modifications'),
        `le serveur doit accorder la lecture à ${role}`
      );
      assert.ok(
        interfaceAdmin[role]?.has('credits.lire_modifications'),
        `l’interface doit accorder la lecture à ${role} — c’est elle qui fait apparaître l’onglet`
      );
    }

    // Et personne ne tient deux maillons : une seule personne ne doit
    // jamais pouvoir faire avancer une demande toute seule.
    const maillons = Object.values(chaine);
    for (const role of Object.keys(PERMISSIONS)) {
      const tenus = maillons.filter((m) => PERMISSIONS[role]?.includes(m));
      assert.ok(
        tenus.length <= 1,
        `${role} tient ${tenus.length} maillons (${tenus.join(', ')}) : il pourrait avancer seul`
      );
    }
  });
});
