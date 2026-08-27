import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import routes from './routes/index.js';
import webhookRoutes from './routes/webhooks.routes.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();

  // Derrière un reverse proxy (nginx, Render, Railway), sans ceci
  // req.ip renvoie l'IP du proxy et la limitation de débit devient
  // inutile : tout le trafic paraît venir d'une seule adresse.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: true,
    })
  );

  app.use(
    pinoHttp({
      level: config.env === 'production' ? 'info' : 'debug',
      // Ne jamais journaliser de code PIN, mot de passe ou jeton :
      // les journaux sont souvent moins protégés que la base.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.body.pin',
          'req.body.codePin',
          'req.body.password',
          'req.body.motDePasse',
          'req.body.refreshToken',
        ],
        remove: true,
      },
    })
  );

  // Les webhooks sont montés AVANT express.json() car la vérification
  // de signature a besoin du corps brut, octet pour octet.
  app.use('/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);

  app.use(express.json({ limit: '1mb' }));

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Trop de requêtes. Patientez un instant.' },
    })
  );

  app.get('/sante', (_req, res) => {
    res.json({ status: 'ok', env: config.env, time: new Date().toISOString() });
  });

  app.use('/v1', routes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
