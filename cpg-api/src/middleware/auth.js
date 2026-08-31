import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db/index.js';
import { can } from '../utils/permissions.js';
import { ApiError } from './errorHandler.js';

/**
 * Vérifie le jeton d'accès et charge l'utilisateur.
 *
 * On relit l'utilisateur en base à chaque requête plutôt que de faire
 * confiance au contenu du jeton. Sinon, un employé licencié conserverait
 * ses droits jusqu'à l'expiration de son jeton — jusqu'à 15 minutes
 * pendant lesquelles il peut approuver des crédits.
 */
export async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw new ApiError(401, 'Jeton d’authentification manquant.');
    }

    let payload;
    try {
      payload = jwt.verify(token, config.jwt.secret);
    } catch {
      throw new ApiError(401, 'Session expirée ou jeton invalide.');
    }

    const { rows } = await query(
      'SELECT id, full_name, role, status, client_number, job_title, created_at FROM users WHERE id = $1',
      [payload.sub]
    );
    const user = rows[0];

    if (!user) throw new ApiError(401, 'Compte introuvable.');
    if (user.status !== 'actif') {
      throw new ApiError(403, 'Ce compte est suspendu. Contactez votre agence.');
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

/** Restreint une route à un ou plusieurs rôles. */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new ApiError(401, 'Authentification requise.'));
    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, 'Votre poste ne donne pas accès à cette action.'));
    }
    next();
  };
}

/** Restreint une route à une capacité précise. À préférer à requireRole. */
export function requirePermission(permission) {
  return (req, _res, next) => {
    if (!req.user) return next(new ApiError(401, 'Authentification requise.'));
    if (!can(req.user.role, permission)) {
      return next(new ApiError(403, 'Votre poste ne donne pas accès à cette action.'));
    }
    next();
  };
}

/**
 * Empêche un client de lire les données d'un autre client.
 *
 * Sans cette vérification, /comptes/:id renvoie le solde de n'importe
 * quel compte à quiconque devine un identifiant. C'est la faille la plus
 * courante des API bancaires : l'authentification passe, l'autorisation
 * manque.
 */
export async function requireOwnership(req, _res, next) {
  try {
    if (req.user.role !== 'client') return next(); // employés : contrôlé par permission

    const accountId = req.params.accountId ?? req.params.id;
    const { rows } = await query('SELECT user_id FROM accounts WHERE id = $1', [accountId]);

    if (!rows[0]) throw new ApiError(404, 'Compte introuvable.');
    if (rows[0].user_id !== req.user.id) {
      // On renvoie 404 et non 403 : dire « interdit » confirmerait à un
      // attaquant que cet identifiant existe.
      throw new ApiError(404, 'Compte introuvable.');
    }
    next();
  } catch (error) {
    next(error);
  }
}
