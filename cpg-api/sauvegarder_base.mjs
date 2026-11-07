/**
 * ═══════════════════════════════════════════════════════════════════
 *  SAUVEGARDE CHIFFRÉE DE LA BASE, DÉTENUE PAR CPG
 * ═══════════════════════════════════════════════════════════════════
 *
 * Au 07/11/2026, les seules sauvegardes de la base étaient celles que
 * Railway fait de son côté : CPG n'en détenait aucune copie. Un compte
 * suspendu — un impayé, un litige — et l'historique de 253 crédits
 * partait avec. C'était le risque le plus lourd du projet, avant toute
 * question d'hébergement.
 *
 * Ce script produit une sauvegarde complète, chiffrée, posée sur une
 * machine qui nous appartient.
 *
 * CE QU'IL FAIT
 *   • `pg_dump` au format custom (restaurable table par table) ;
 *   • chiffrement AES-256-GCM, clé dérivée par scrypt depuis un fichier
 *     de clé local. GCM est authentifié : une sauvegarde corrompue ou
 *     modifiée est détectée au déchiffrement, elle ne se restaure pas
 *     silencieusement de travers ;
 *   • un manifeste en clair à côté de chaque sauvegarde — date, taille,
 *     empreinte SHA-256, version de PostgreSQL, et le NOMBRE DE LIGNES
 *     de chaque table au moment du dump. C'est lui qui permet de
 *     vérifier une restauration sans accès à la production ;
 *   • une rétention : les 14 derniers jours, puis une par semaine
 *     pendant 12 semaines. Au-delà, suppression.
 *
 * POURQUOI PAS openssl
 *   LibreSSL 2.8.3, l'openssl livré avec macOS, ne connaît pas
 *   `-pbkdf2` : il dérive la clé d'une phrase de passe en un seul tour
 *   de MD5. Pour un fichier contenant les soldes et les salaires de
 *   tous les clients, ce n'est pas défendable. `node:crypto` fait du
 *   scrypt sans rien installer.
 *
 * L'URL DE PRODUCTION N'APPARAÎT JAMAIS
 *   Ni à l'écran, ni dans la ligne de commande de `pg_dump` — elle est
 *   décomposée en variables d'environnement PG*, invisibles de `ps`.
 *
 * LA CLÉ
 *   Créée au premier lancement dans ~/.cpg/cle-sauvegarde (32 octets
 *   aléatoires, permissions 600). **Perdre cette clé rend toutes les
 *   sauvegardes illisibles.** Le script le dit et insiste : il faut en
 *   garder une copie ailleurs que sur le Mac.
 *
 *   node cpg-api/sauvegarder_base.mjs --aide
 *   railway run --service Postgres -- node cpg-api/sauvegarder_base.mjs
 *   railway run --service Postgres -- node cpg-api/sauvegarder_base.mjs --verifier
 */
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync,
  readFileSync, statSync, unlinkSync, writeFileSync, chmodSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createCipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

const DOSSIER = process.env.CPG_SAUVEGARDES ?? path.join(homedir(), 'Sauvegardes-CPG');
// Une sauvegarde posee au seul endroit ou tourne le script ne protege
// pas d'un Mac vole, noye ou en panne de disque. `CPG_MIROIR` designe un
// second emplacement — cle USB, iCloud Drive, disque reseau — ou chaque
// sauvegarde est recopiee aussitot. Sans elle, le script le rappelle a
// chaque passage.
const MIROIR = process.env.CPG_MIROIR ?? null;
const FICHIER_CLE = process.env.CPG_CLE_SAUVEGARDE ?? path.join(homedir(), '.cpg', 'cle-sauvegarde');
const JOURS_QUOTIDIENS = 14;
const SEMAINES_HEBDO = 12;
// N=2^15 et r=8 demandent 128 * N * r = 33,5 Mo, juste au-dessus de la
// limite par defaut de node:crypto (32 Mo) : `maxmem` doit donc etre
// declare, sinon scrypt refuse avec « memory limit exceeded ».
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const aide = process.argv.includes('--aide');
const verifier = process.argv.includes('--verifier');

if (aide) {
  console.log(`
SAUVEGARDE DE LA BASE CPG

  railway run --service Postgres -- node cpg-api/sauvegarder_base.mjs
      Prend une sauvegarde chiffree dans ${DOSSIER}

  railway run --service Postgres -- node cpg-api/sauvegarder_base.mjs --verifier
      Restaure la derniere sauvegarde dans une base locale jetable et
      compare les comptes de lignes au manifeste. A faire une fois par
      mois : une sauvegarde jamais restauree n'est pas une sauvegarde.

Variables :
  CPG_SAUVEGARDES      ou poser les fichiers (defaut ${path.join('~', 'Sauvegardes-CPG')})
  CPG_MIROIR           second emplacement ou recopier (cle USB, iCloud Drive…)
  CPG_CLE_SAUVEGARDE   le fichier de cle (defaut ~/.cpg/cle-sauvegarde)
`);
  process.exit(0);
}

if (!process.env.DATABASE_PUBLIC_URL) {
  console.error('DATABASE_PUBLIC_URL absente. Lancez avec : railway run --service Postgres -- node …');
  process.exit(1);
}

// ── La clé ─────────────────────────────────────────────────────────
function chargerCle() {
  if (existsSync(FICHIER_CLE)) return readFileSync(FICHIER_CLE);
  mkdirSync(path.dirname(FICHIER_CLE), { recursive: true, mode: 0o700 });
  const cle = randomBytes(32);
  writeFileSync(FICHIER_CLE, cle, { mode: 0o600 });
  chmodSync(FICHIER_CLE, 0o600);
  console.log(`
  ╔══════════════════════════════════════════════════════════════════╗
  ║  UNE CLE DE CHIFFREMENT VIENT D'ETRE CREEE                       ║
  ║                                                                  ║
  ║  ${FICHIER_CLE.padEnd(62)}║
  ║                                                                  ║
  ║  SANS ELLE, AUCUNE SAUVEGARDE NE PEUT ETRE RESTAUREE.            ║
  ║  Mettez-en une copie ailleurs que sur ce Mac — cle USB dans un   ║
  ║  coffre, ou gestionnaire de mots de passe. Pas dans le depot.    ║
  ╚══════════════════════════════════════════════════════════════════╝
`);
  return cle;
}

// ── Connexion, sans jamais exposer l'URL ───────────────────────────
function envPg() {
  const u = new URL(process.env.DATABASE_PUBLIC_URL);
  return {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: u.pathname.replace(/^\//, ''),
    PGSSLMODE: 'require',
    DATABASE_PUBLIC_URL: undefined,
  };
}

// Ce script n'utilise QUE psql et pg_dump, jamais le pilote `pg` du
// depot. C'est delibere : l'agent launchd qui le lance chaque soir n'a
// pas acces a ~/Documents — un dossier protege par macOS — et ne peut
// donc pas charger les node_modules du projet. Sans dependance, le
// script se recopie hors de Documents et tourne de partout.
const execFileP = promisify(execFile);

/** Une valeur scalaire, lue par psql. */
async function scalaire(sql) {
  const { stdout } = await execFileP('psql', ['-X', '-A', '-t', '-c', sql], { env: envPg() });
  return stdout.trim();
}

/** Le nombre de lignes de chaque table : c'est la preuve de la restauration. */
async function compterLesLignes() {
  const liste = await scalaire(
    `SELECT string_agg(tablename, ',' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public'`
  );
  const tables = liste ? liste.split(',') : [];
  const comptes = {};
  // Une seule requete pour tout compter : 39 allers-retours sur un
  // endpoint public, c'est 39 fois la latence.
  if (tables.length) {
    const union = tables
      .map((t) => `SELECT '${t}' AS t, count(*)::bigint AS n FROM public."${t}"`)
      .join(' UNION ALL ');
    const { stdout } = await execFileP('psql', ['-X', '-A', '-t', '-F', '|', '-c', union], { env: envPg() });
    for (const ligne of stdout.trim().split('\n')) {
      const [t, n] = ligne.split('|');
      comptes[t] = Number(n);
    }
  }
  return comptes;
}

const f = (n) => Number(n).toLocaleString('fr-FR');
const octets = (n) => (n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} Ko` : `${(n / 1024 / 1024).toFixed(1)} Mo`);

// ── Rétention ──────────────────────────────────────────────────────
function semaineIso(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const jour = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - jour);
  const debut = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-S${String(Math.ceil(((t - debut) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}

function appliquerRetention() {
  const fichiers = readdirSync(DOSSIER)
    .filter((n) => n.endsWith('.dump.enc'))
    .map((n) => ({ n, d: new Date(statSync(path.join(DOSSIER, n)).mtime) }))
    .sort((a, b) => b.d - a.d);

  const limite = Date.now() - JOURS_QUOTIDIENS * 86400000;
  const gardees = new Set();
  const parSemaine = new Map();

  for (const x of fichiers) {
    if (x.d.getTime() >= limite) { gardees.add(x.n); continue; }
    const s = semaineIso(x.d);
    // La plus récente de chaque semaine, dans la limite de SEMAINES_HEBDO.
    if (!parSemaine.has(s) && parSemaine.size < SEMAINES_HEBDO) {
      parSemaine.set(s, x.n);
      gardees.add(x.n);
    }
  }

  const supprimees = [];
  for (const x of fichiers) {
    if (gardees.has(x.n)) continue;
    unlinkSync(path.join(DOSSIER, x.n));
    const m = path.join(DOSSIER, x.n.replace('.dump.enc', '.json'));
    if (existsSync(m)) unlinkSync(m);
    supprimees.push(x.n);
  }
  return { total: gardees.size, supprimees };
}

// ── Vérification ───────────────────────────────────────────────────
async function verifierLaDerniere() {
  const fichiers = readdirSync(DOSSIER)
    .filter((n) => n.endsWith('.dump.enc'))
    .sort()
    .reverse();
  if (!fichiers.length) {
    console.error(`Aucune sauvegarde dans ${DOSSIER}. Prenez-en une d'abord.`);
    process.exit(1);
  }
  const { verifierSauvegarde } = await import(new URL('./verifier_sauvegarde.mjs', import.meta.url));
  await verifierSauvegarde({ DOSSIER, FICHIER_CLE, fichier: fichiers[0], SCRYPT });
}

// ── Sauvegarde ─────────────────────────────────────────────────────
async function sauvegarder() {
  mkdirSync(DOSSIER, { recursive: true, mode: 0o700 });
  const cle = chargerCle();

  const version = await scalaire('SELECT version()');
  const base = await scalaire('SELECT current_database()');
  const tailleBase = await scalaire('SELECT pg_size_pretty(pg_database_size(current_database()))');
  console.log(`Base « ${base} », ${tailleBase}`);
  console.log(`${version.split(',')[0]}\n`);

  console.log('Comptage des lignes, table par table…');
  const comptes = await compterLesLignes();
  const lignes = Object.values(comptes).reduce((s, n) => s + n, 0);
  console.log(`  ${Object.keys(comptes).length} tables, ${f(lignes)} lignes au total\n`);

  const horodatage = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const nom = `cpg-${horodatage}`;
  const cible = path.join(DOSSIER, `${nom}.dump.enc`);

  // scrypt : le sel est propre à cette sauvegarde, stocké en tête du
  // fichier. Deux sauvegardes de la même base ne donnent donc jamais
  // le même octet, et la clé ne se devine pas depuis le fichier.
  const sel = randomBytes(16);
  const iv = randomBytes(12);
  const cleDerivee = scryptSync(cle, sel, 32, SCRYPT);
  const chiffreur = createCipheriv('aes-256-gcm', cleDerivee, iv);
  const empreinte = createHash('sha256');

  console.log('pg_dump en cours…');
  const dump = spawn('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--compress=6'],
    { env: envPg(), stdio: ['ignore', 'pipe', 'pipe'] });

  let erreurs = '';
  dump.stderr.on('data', (d) => { erreurs += d.toString(); });

  const sortie = createWriteStream(cible, { mode: 0o600 });
  // En-tête en clair : magie, version, sel, IV. Puis le corps chiffré,
  // puis l'étiquette d'authentification GCM, écrite à la fin.
  const entete = Buffer.concat([Buffer.from('CPGSAV01'), sel, iv]);
  sortie.write(entete);
  empreinte.update(entete);

  let brut = 0;
  await new Promise((resolve, reject) => {
    dump.stdout.on('data', (morceau) => {
      brut += morceau.length;
      const chiffre = chiffreur.update(morceau);
      sortie.write(chiffre);
      empreinte.update(chiffre);
    });
    dump.on('error', reject);
    dump.on('close', (code) => {
      if (code !== 0) return reject(new Error(`pg_dump a echoue (code ${code})\n${erreurs}`));
      const fin = chiffreur.final();
      const etiquette = chiffreur.getAuthTag();
      sortie.write(fin);
      empreinte.update(fin);
      sortie.write(etiquette);
      empreinte.update(etiquette);
      sortie.end(resolve);
      return undefined;
    });
  });

  const taille = statSync(cible).size;
  const sha = empreinte.digest('hex');
  const manifeste = {
    fichier: path.basename(cible),
    pris_le: new Date().toISOString(),
    postgres: version.split(',')[0],
    base,
    taille_chiffree: taille,
    taille_dump: brut,
    sha256: sha,
    chiffrement: 'aes-256-gcm, cle derivee par scrypt (N=2^15, r=8, p=1)',
    tables: Object.keys(comptes).length,
    lignes_total: lignes,
    comptes,
  };
  writeFileSync(path.join(DOSSIER, `${nom}.json`), `${JSON.stringify(manifeste, null, 2)}\n`, { mode: 0o600 });

  console.log(`\nSauvegarde ecrite`);
  console.log(`  ${cible}`);
  console.log(`  ${octets(taille)} chiffres (${octets(brut)} de dump)`);
  console.log(`  sha256 ${sha.slice(0, 32)}…`);
  console.log(`  manifeste : ${nom}.json`);

  if (MIROIR) {
    mkdirSync(MIROIR, { recursive: true });
    for (const n of [`${nom}.dump.enc`, `${nom}.json`]) {
      copyFileSync(path.join(DOSSIER, n), path.join(MIROIR, n));
    }
    console.log(`\nCopie miroir`);
    console.log(`  ${MIROIR}`);
  } else {
    console.log(`\nPas de copie miroir : cette sauvegarde n'existe qu'ici.`);
    console.log(`  Posez CPG_MIROIR sur une cle USB ou un dossier synchronise`);
    console.log(`  pour qu'un Mac perdu n'emporte pas l'historique avec lui.`);
  }

  const { total, supprimees } = appliquerRetention();
  console.log(`\nRetention : ${total} sauvegarde(s) conservee(s)`);
  if (supprimees.length) {
    console.log(`  ${supprimees.length} ancienne(s) supprimee(s) :`);
    for (const n of supprimees) console.log(`    ${n}`);
  }
  console.log(`\nVerifiez une restauration au moins une fois par mois :`);
  console.log(`  railway run --service Postgres -- node cpg-api/sauvegarder_base.mjs --verifier`);
}

try {
  if (verifier) await verifierLaDerniere();
  else await sauvegarder();
} catch (e) {
  console.error(`\nECHEC — ${e.message}`);
  process.exitCode = 1;
}
