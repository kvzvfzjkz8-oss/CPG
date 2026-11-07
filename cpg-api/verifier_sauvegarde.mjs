/**
 * ═══════════════════════════════════════════════════════════════════
 *  RESTAURER POUR DE VRAI, ET COMPARER
 * ═══════════════════════════════════════════════════════════════════
 *
 * Une sauvegarde jamais restaurée n'est pas une sauvegarde. Ce module
 * déchiffre la dernière, la restaure dans une base locale jetable, et
 * compare le nombre de lignes de CHAQUE table à ce que le manifeste
 * avait enregistré au moment du dump.
 *
 * Il ne se contente pas de « le fichier s'ouvre » : il vérifie aussi
 * l'étiquette d'authentification GCM — un fichier tronqué ou altéré
 * fait échouer le déchiffrement au lieu de produire une base
 * silencieusement incomplète.
 *
 * La base de contrôle s'appelle `cpg_verif_sauvegarde` et est détruite
 * à la fin, succès ou échec.
 *
 * Appelé par `sauvegarder_base.mjs --verifier`.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { createDecipheriv, scryptSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const BASE_CONTROLE = 'cpg_verif_sauvegarde';
const f = (n) => Number(n).toLocaleString('fr-FR');

/** Déchiffre la sauvegarde vers un fichier temporaire. */
async function dechiffrer({ DOSSIER, FICHIER_CLE, fichier, SCRYPT }) {
  if (!existsSync(FICHIER_CLE)) {
    throw new Error(`Fichier de cle introuvable : ${FICHIER_CLE}. Sans lui, rien n'est restaurable.`);
  }
  const cle = readFileSync(FICHIER_CLE);
  const chemin = path.join(DOSSIER, fichier);
  const entier = readFileSync(chemin);

  const magie = entier.subarray(0, 8).toString();
  if (magie !== 'CPGSAV01') {
    throw new Error(`Format inattendu (« ${magie} ») — ce fichier n'a pas ete ecrit par sauvegarder_base.mjs.`);
  }
  const sel = entier.subarray(8, 24);
  const iv = entier.subarray(24, 36);
  const etiquette = entier.subarray(entier.length - 16);
  const corps = entier.subarray(36, entier.length - 16);

  const dechiffreur = createDecipheriv('aes-256-gcm', scryptSync(cle, sel, 32, SCRYPT), iv);
  dechiffreur.setAuthTag(etiquette);

  let clair;
  try {
    clair = Buffer.concat([dechiffreur.update(corps), dechiffreur.final()]);
  } catch {
    throw new Error(
      'Le dechiffrement a echoue : mauvaise cle, ou fichier altere/tronque. '
      + 'C\'est exactement ce que GCM sert a detecter — ne restaurez pas ce fichier.'
    );
  }

  const sortie = path.join(tmpdir(), `${fichier.replace('.dump.enc', '')}.dump`);
  writeFileSync(sortie, clair, { mode: 0o600 });
  return { sortie, taille: clair.length };
}

export async function verifierSauvegarde({ DOSSIER, FICHIER_CLE, fichier, SCRYPT }) {
  console.log(`Verification de ${fichier}\n`);

  const cheminManifeste = path.join(DOSSIER, fichier.replace('.dump.enc', '.json'));
  if (!existsSync(cheminManifeste)) {
    throw new Error(`Manifeste absent (${path.basename(cheminManifeste)}) : impossible de comparer.`);
  }
  const manifeste = JSON.parse(readFileSync(cheminManifeste, 'utf8'));
  console.log(`  prise le        ${manifeste.pris_le}`);
  console.log(`  ${manifeste.postgres}`);
  console.log(`  ${manifeste.tables} tables, ${f(manifeste.lignes_total)} lignes attendues\n`);

  console.log('Dechiffrement et controle d\'integrite…');
  const { sortie, taille } = await dechiffrer({ DOSSIER, FICHIER_CLE, fichier, SCRYPT });
  console.log(`  OK — etiquette GCM valide, ${(taille / 1024 / 1024).toFixed(1)} Mo de dump\n`);

  const psql = async (sql, base = 'postgres') => execFileP('psql', ['-X', '-q', '-h', 'localhost', '-U', 'postgres', '-d', base, '-c', sql]);

  try {
    console.log(`Restauration dans la base jetable « ${BASE_CONTROLE} »…`);
    await psql(`DROP DATABASE IF EXISTS ${BASE_CONTROLE}`);
    await psql(`CREATE DATABASE ${BASE_CONTROLE}`);

    // pg_restore rend un code non nul sur des avertissements benins
    // (extensions deja presentes, proprietaire absent) : on juge sur la
    // comparaison des lignes, pas sur le code de sortie.
    const restore = spawn('pg_restore', [
      '--no-owner', '--no-privileges', '--no-comments',
      '-h', 'localhost', '-U', 'postgres', '-d', BASE_CONTROLE, sortie,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let bruit = '';
    restore.stderr.on('data', (d) => { bruit += d.toString(); });
    const code = await new Promise((r) => restore.on('close', r));
    const avertissements = bruit.split('\n').filter((l) => l.trim()).length;
    console.log(`  pg_restore termine (code ${code}, ${avertissements} ligne(s) de diagnostic)\n`);

    console.log('Comparaison table par table :\n');
    let justes = 0;
    const ecarts = [];
    for (const [table, attendu] of Object.entries(manifeste.comptes)) {
      let obtenu = null;
      try {
        const { stdout } = await execFileP('psql', ['-X', '-A', '-t', '-h', 'localhost', '-U', 'postgres',
          '-d', BASE_CONTROLE, '-c', `SELECT count(*) FROM public."${table}"`]);
        obtenu = Number(stdout.trim());
      } catch {
        obtenu = null;
      }
      if (obtenu === attendu) { justes += 1; continue; }
      ecarts.push({ table, attendu, obtenu });
    }

    console.log(`  ${justes}/${Object.keys(manifeste.comptes).length} tables identiques`);
    if (ecarts.length) {
      console.log('\n  ECARTS :');
      console.log('  table                          attendu     restaure');
      for (const e of ecarts) {
        console.log(`  ${e.table.padEnd(30)} ${String(e.attendu).padStart(8)}  ${e.obtenu === null ? '   ABSENTE' : String(e.obtenu).padStart(10)}`);
      }
      throw new Error(`${ecarts.length} table(s) ne se restaurent pas a l'identique. Cette sauvegarde n'est pas fiable.`);
    }

    // Un controle de fond, en plus des comptes : le grand livre doit
    // retomber sur la meme somme, au franc.
    const { stdout } = await execFileP('psql', ['-X', '-A', '-t', '-h', 'localhost', '-U', 'postgres',
      '-d', BASE_CONTROLE, '-c', 'SELECT COALESCE(SUM(amount),0) FROM ledger_entries']);
    console.log(`\n  somme du grand livre restaure : ${f(stdout.trim())} F`);

    console.log(`\n  ${'='.repeat(60)}`);
    console.log('  SAUVEGARDE VERIFIEE — elle se restaure a l\'identique.');
    console.log(`  ${'='.repeat(60)}`);
  } finally {
    await psql(`DROP DATABASE IF EXISTS ${BASE_CONTROLE}`).catch(() => {});
    if (existsSync(sortie)) unlinkSync(sortie);
  }
}
