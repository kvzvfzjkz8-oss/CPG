import { ZodError } from 'zod';
import multer from 'multer';
import { config } from '../config.js';

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function notFound(_req, _res, next) {
  next(new ApiError(404, 'Ressource introuvable.'));
}

/**
 * Gestionnaire d'erreurs unique.
 *
 * Règle : ne jamais renvoyer au client la trace d'exécution ni le message
 * brut d'une erreur PostgreSQL. Ces messages révèlent les noms de tables
 * et de colonnes, ce qui aide un attaquant à construire la requête
 * suivante. On journalise en détail côté serveur, on répond sobrement.
 */
export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(422).json({
      error: 'Données invalides.',
      details: err.issues.map((i) => ({ champ: i.path.join('.'), message: i.message })),
    });
  }

  // Fichier trop volumineux, champ inattendu… : erreur d'upload, pas
  // une panne serveur. multer.MulterError n'expose pas de `.status`,
  // contrairement à ApiError, d'où ce cas à part.
  if (err instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE: 'Le fichier dépasse la taille maximale autorisée.',
      LIMIT_UNEXPECTED_FILE: 'Champ de fichier inattendu.',
    };
    return res.status(422).json({
      error: messages[err.code] ?? 'Fichier invalide.',
      code: err.code,
    });
  }

  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }

  // Certaines erreurs métier (RateError dans rateVersioning.js, par
  // exemple) portent un statut HTTP explicite sans hériter d'ApiError :
  // ce fichier reste volontairement sans import pour rester testable
  // isolément. On les reconnaît ici par duck-typing plutôt que de leur
  // imposer une dépendance vers ce module.
  if (typeof err.status === 'number' && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }

  // Violation de contrainte d'unicité PostgreSQL.
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Cette entrée existe déjà.' });
  }

  req.log?.error({ err }, 'Erreur non gérée');

  res.status(500).json({
    error: 'Une erreur interne est survenue.',
    ...(config.env === 'development' ? { debug: err.message } : {}),
  });
}
