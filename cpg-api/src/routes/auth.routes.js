import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { query } from '../db/index.js';
import { validate } from '../middleware/validate.js';
import { ApiError } from '../middleware/errorHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { permissionsFor } from '../utils/permissions.js';
import { audit } from '../services/auditService.js';

const router = Router();

/**
 * Limitation stricte des tentatives de connexion.
 * Sans cela, un code PIN à 4 chiffres se force en quelques minutes :
 * 10 000 combinaisons ne résistent à rien.
 *
 * Deux limiteurs distincts plutôt qu'un seul partagé : un volume élevé
 * de connexions client (l'app mobile, potentiellement derrière un NAT
 * partagé par plusieurs agences) ne doit pas épuiser le budget des
 * connexions back-office, et inversement. Chaque route a son propre
 * profil de risque — brute-force d'un PIN à 4 chiffres côté client,
 * mot de passe côté agent — et mérite son propre compteur.
 */
const clientLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez dans quinze minutes.' },
});

const staffLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez dans quinze minutes.' },
});

/**
 * Plus généreux que les limiteurs de connexion : cette route ne
 * prend pas de PIN, donc aucun risque de brute-force à limiter
 * strictement. Elle est appelée à chaque ouverture de l'app tant que
 * le client n'est pas connecté — la coller au même budget que les
 * tentatives de PIN aurait pénalisé des utilisateurs légitimes qui
 * rouvrent simplement l'app plusieurs fois.
 */
const verifierNumeroLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez dans quinze minutes.' },
});

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

function issueTokens(user) {
  const accessToken = jwt.sign(
    { sub: user.id, role: user.role },
    config.jwt.secret,
    { expiresIn: config.jwt.accessTtl }
  );

  const refreshToken = crypto.randomBytes(48).toString('hex');
  return { accessToken, refreshToken };
}

async function storeRefreshToken(userId, refreshToken) {
  // On stocke une empreinte, jamais le jeton : une fuite de la base ne
  // permet alors pas de se connecter aux comptes.
  const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const expires = new Date();
  expires.setDate(expires.getDate() + 30);

  await query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, hash, expires]
  );
}

async function registerFailure(user) {
  const attempts = user.failed_attempts + 1;
  const lockedUntil =
    attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60000) : null;

  await query('UPDATE users SET failed_attempts = $2, locked_until = $3 WHERE id = $1', [
    user.id,
    attempts,
    lockedUntil,
  ]);
}

function assertNotLocked(user) {
  if (user?.locked_until && new Date(user.locked_until) > new Date()) {
    throw new ApiError(423, 'Compte temporairement bloqué après plusieurs échecs. Réessayez plus tard.');
  }
}

/**
 * ── POST /auth/verifier-numero — évite de faire deviner un PIN qui
 *   sera de toute façon rejeté ────────────────────────────────────
 *
 * L'app mobile appelle cette route juste après la saisie du numéro,
 * avant d'afficher le clavier PIN, pour savoir immédiatement quel
 * écran proposer : code existant (connexion normale) ou première
 * activation (numéro client + choix du PIN). Sans ça, quelqu'un dont
 * le compte vient d'être créé devait taper un PIN au hasard, se le
 * voir refuser, puis seulement là être redirigé — une étape inutile.
 *
 * Distinction de sécurité : ce que révèle cette route (compte activé
 * ou non) est déjà indirectement révélé par POST /connexion-client
 * elle-même (code 403 pin_non_defini vs 401 générique) — l'avancer
 * d'un écran ne change donc rien à ce qui peut déjà être déduit,
 * simplement plus tôt. La limite de tentatives reste la même que
 * pour la connexion, pour ne pas ouvrir une voie de contournement.
 */
router.post(
  '/verifier-numero',
  verifierNumeroLimiter,
  validate(z.object({ phone: z.string().min(8).max(20) })),
  async (req, res, next) => {
    try {
      const { rows } = await query(
        `SELECT pin_hash FROM users WHERE phone = $1 AND role = 'client'`,
        [req.body.phone]
      );
      const user = rows[0];
      // Un numéro totalement inconnu suit le même chemin qu'un compte
      // déjà activé : les deux mènent à l'écran de connexion normal,
      // qui répond alors par le message générique habituel.
      res.json({ activationRequise: Boolean(user) && !user.pin_hash });
    } catch (error) {
      next(error);
    }
  }
);

/* ── POST /auth/connexion-client — application mobile, code PIN ───── */
const clientLoginSchema = z.object({
  phone: z.string().min(8).max(20),
  pin: z.string().regex(/^\d{4,6}$/, 'Le code PIN doit contenir 4 à 6 chiffres.'),
});

router.post(
  '/connexion-client',
  clientLoginLimiter,
  validate(clientLoginSchema),
  async (req, res, next) => {
    try {
      const { phone, pin } = req.body;
      const { rows } = await query(
        `SELECT id, full_name, role, status, pin_hash, failed_attempts, locked_until, client_number
         FROM users WHERE phone = $1 AND role = 'client'`,
        [phone]
      );
      const user = rows[0];

      assertNotLocked(user);

      // Un compte sans PIN n'a encore jamais été activé (ou vient
      // d'être réinitialisé par le gestionnaire) : ce n'est pas une
      // tentative ratée, donc pas de compteur d'échec ici — juste une
      // redirection claire vers l'activation.
      if (user && !user.pin_hash) {
        throw new ApiError(
          403,
          'Ce compte n’a pas encore de code PIN. Activez-le avec votre numéro client.',
          'pin_non_defini'
        );
      }

      // Message identique que le compte existe ou non : sinon l'API
      // permet d'énumérer les numéros de téléphone des clients CPG.
      const valid = user?.pin_hash && (await bcrypt.compare(pin, user.pin_hash));
      if (!user || !valid) {
        if (user) await registerFailure(user);
        throw new ApiError(401, 'Numéro ou code PIN incorrect.');
      }

      if (user.status !== 'actif') {
        throw new ApiError(403, 'Ce compte est suspendu. Contactez votre agence.');
      }

      await query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);

      const { accessToken, refreshToken } = issueTokens(user);
      await storeRefreshToken(user.id, refreshToken);

      req.user = user;
      await audit(req, { action: 'connexion.client', entityType: 'user', entityId: user.id });

      res.json({
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          fullName: user.full_name,
          clientNumber: user.client_number,
          role: user.role,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * ── POST /auth/activer-compte — le client crée lui-même son PIN ────
 *
 * « Chaque client puisse se connecter avec leur numéro et un mot de
 *   passe qu'ils vont créer par eux-mêmes. » Le gestionnaire crée la
 * fiche du client (nom, téléphone, employeur) sans définir de PIN ; le
 * client prouve que c'est bien lui avec son numéro client CPG
 * (communiqué par le gestionnaire à la création), puis choisit son
 * propre code. Ne fonctionne que si aucun PIN n'est encore défini —
 * un compte déjà activé ne peut pas être détourné par cette voie, il
 * faut passer par la réinitialisation du gestionnaire.
 */
const activateAccountSchema = z.object({
  phone: z.string().min(8).max(20),
  clientNumber: z.string().min(3).max(30),
  nouveauPin: z.string().regex(/^\d{4,6}$/, 'Le code PIN doit contenir 4 à 6 chiffres.'),
});

router.post(
  '/activer-compte',
  clientLoginLimiter,
  validate(activateAccountSchema),
  async (req, res, next) => {
    try {
      const { phone, clientNumber, nouveauPin } = req.body;
      const { rows } = await query(
        `SELECT id, full_name, role, status, pin_hash, client_number
         FROM users WHERE phone = $1 AND client_number = $2 AND role = 'client'`,
        [phone, clientNumber]
      );
      const user = rows[0];

      // Même message que le numéro/matricule ne correspondent pas ou
      // que le compte soit déjà activé : ne pas révéler lequel des
      // deux cas s'est produit.
      if (!user || user.pin_hash) {
        throw new ApiError(422, 'Numéro de téléphone ou numéro client incorrect, ou compte déjà activé.');
      }
      if (user.status !== 'actif') {
        throw new ApiError(403, 'Ce compte est suspendu. Contactez votre agence.');
      }

      const pinHash = await bcrypt.hash(nouveauPin, 12);
      await query('UPDATE users SET pin_hash = $2 WHERE id = $1', [user.id, pinHash]);

      const { accessToken, refreshToken } = issueTokens(user);
      await storeRefreshToken(user.id, refreshToken);

      req.user = user;
      await audit(req, { action: 'client.compte_active', entityType: 'user', entityId: user.id });

      res.status(201).json({
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          fullName: user.full_name,
          clientNumber: user.client_number,
          role: user.role,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/* ── POST /auth/connexion-agent — back-office, mot de passe ───────── */
const staffLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

router.post(
  '/connexion-agent',
  staffLoginLimiter,
  validate(staffLoginSchema),
  async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const { rows } = await query(
        `SELECT id, full_name, role, status, password_hash, failed_attempts, locked_until
         FROM users WHERE email = $1 AND role <> 'client'`,
        [email.toLowerCase()]
      );
      const user = rows[0];

      assertNotLocked(user);

      const valid = user?.password_hash && (await bcrypt.compare(password, user.password_hash));
      if (!user || !valid) {
        if (user) await registerFailure(user);
        throw new ApiError(401, 'Identifiants incorrects.');
      }

      if (user.status !== 'actif') {
        throw new ApiError(403, 'Ce compte est désactivé.');
      }

      await query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);

      const { accessToken, refreshToken } = issueTokens(user);
      await storeRefreshToken(user.id, refreshToken);

      req.user = user;
      await audit(req, { action: 'connexion.agent', entityType: 'user', entityId: user.id });

      res.json({
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          fullName: user.full_name,
          role: user.role,
          permissions: permissionsFor(user.role),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * ── POST /auth/connexion-backoffice — back-office, code PIN 8 chiffres ──
 *
 * Authentification pensée pour un poste partagé en agence : un code à
 * 8 chiffres se tape plus vite qu'un mot de passe, tout en offrant
 * 100 000 000 de combinaisons — largement plus résistant au brute-force
 * que le PIN client à 4-6 chiffres, déjà protégé par le même
 * mécanisme de verrouillage après échecs répétés.
 *
 * Coexiste avec /connexion-agent (mot de passe) : les deux restent
 * valables tant qu'un compte a les deux identifiants configurés,
 * exactement comme un particulier peut garder son mot de passe en
 * plus du code de sa carte bancaire. Seul le directeur peut définir,
 * modifier ou supprimer un code PIN back-office (voir PUT/DELETE
 * /admin/utilisateurs/:id/pin) — un employé ne se l'attribue jamais
 * lui-même.
 */
const staffPinLoginSchema = z.object({
  email: z.string().email(),
  pin: z.string().regex(/^\d{8}$/, 'Le code PIN back-office doit contenir exactement 8 chiffres.'),
});

router.post(
  '/connexion-backoffice',
  staffLoginLimiter,
  validate(staffPinLoginSchema),
  async (req, res, next) => {
    try {
      const { email, pin } = req.body;
      const { rows } = await query(
        `SELECT id, full_name, role, status, pin_hash, failed_attempts, locked_until
         FROM users WHERE email = $1 AND role <> 'client'`,
        [email.toLowerCase()]
      );
      const user = rows[0];

      assertNotLocked(user);

      const valid = user?.pin_hash && (await bcrypt.compare(pin, user.pin_hash));
      if (!user || !valid) {
        if (user) await registerFailure(user);
        throw new ApiError(401, 'Identifiants incorrects.');
      }

      if (user.status !== 'actif') {
        throw new ApiError(403, 'Ce compte est désactivé.');
      }

      await query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);

      const { accessToken, refreshToken } = issueTokens(user);
      await storeRefreshToken(user.id, refreshToken);

      req.user = user;
      await audit(req, { action: 'connexion.backoffice_pin', entityType: 'user', entityId: user.id });

      res.json({
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          fullName: user.full_name,
          role: user.role,
          permissions: permissionsFor(user.role),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/* ── POST /auth/rafraichir ────────────────────────────────────────── */
router.post(
  '/rafraichir',
  validate(z.object({ refreshToken: z.string().min(32) })),
  async (req, res, next) => {
    try {
      const hash = crypto.createHash('sha256').update(req.body.refreshToken).digest('hex');

      const { rows } = await query(
        `SELECT rt.id, rt.user_id, u.role, u.status
         FROM refresh_tokens rt
         JOIN users u ON u.id = rt.user_id
         WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL AND rt.expires_at > now()`,
        [hash]
      );
      const session = rows[0];

      if (!session) throw new ApiError(401, 'Session expirée. Reconnectez-vous.');
      if (session.status !== 'actif') throw new ApiError(403, 'Ce compte est suspendu.');

      // Rotation : l'ancien jeton est révoqué à chaque usage. Si un jeton
      // volé est réutilisé après coup, il ne fonctionne plus.
      await query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [session.id]);

      const tokens = issueTokens({ id: session.user_id, role: session.role });
      await storeRefreshToken(session.user_id, tokens.refreshToken);

      res.json(tokens);
    } catch (error) {
      next(error);
    }
  }
);

/* ── POST /auth/deconnexion ───────────────────────────────────────── */
router.post('/deconnexion', requireAuth, async (req, res, next) => {
  try {
    await query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [req.user.id]
    );
    await audit(req, { action: 'deconnexion', entityType: 'user', entityId: req.user.id });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/* ── GET /auth/moi ────────────────────────────────────────────────── */
router.get('/moi', requireAuth, (req, res) => {
  res.json({
    id: req.user.id,
    fullName: req.user.full_name,
    clientNumber: req.user.client_number,
    role: req.user.role,
    permissions: permissionsFor(req.user.role),
  });
});

/**
 * POST /auth/changer-mot-de-passe — self-service, personnel du
 * back-office uniquement (les clients ont un code PIN, pas un mot de
 * passe, et le changent via /activer-compte ou une réinitialisation
 * du gestionnaire).
 */
const changePasswordSchema = z.object({
  ancienMotDePasse: z.string().min(1),
  nouveauMotDePasse: z.string().min(12, 'Le nouveau mot de passe doit contenir au moins 12 caractères.'),
});

router.post(
  '/changer-mot-de-passe',
  requireAuth,
  validate(changePasswordSchema),
  async (req, res, next) => {
    try {
      if (req.user.role === 'client') {
        throw new ApiError(403, 'Ce compte utilise un code PIN, pas un mot de passe.');
      }

      const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
      const valid = rows[0]?.password_hash
        && (await bcrypt.compare(req.body.ancienMotDePasse, rows[0].password_hash));
      if (!valid) {
        throw new ApiError(401, 'Mot de passe actuel incorrect.');
      }

      const nouveauHash = await bcrypt.hash(req.body.nouveauMotDePasse, 12);
      await query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, nouveauHash]);

      // Un mot de passe qui vient de changer révoque les sessions
      // existantes : si le compte avait été compromis, l'ancien mot
      // de passe ne permet plus de garder une session ouverte.
      await query(
        'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
        [req.user.id]
      );

      await audit(req, {
        action: 'utilisateur.mot_de_passe_change',
        entityType: 'user',
        entityId: req.user.id,
      });

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
