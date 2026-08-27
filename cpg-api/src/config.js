import 'dotenv/config';

const required = (key, fallback) => {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Variable d'environnement manquante : ${key}`);
  }
  return value;
};

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),

  databaseUrl: required('DATABASE_URL', 'postgresql://cpg:cpg@localhost:5432/cpg'),

  jwt: {
    secret: required('JWT_SECRET', 'dev-only-secret'),
    refreshSecret: required('JWT_REFRESH_SECRET', 'dev-only-refresh-secret'),
    accessTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
    refreshTtl: process.env.REFRESH_TOKEN_TTL ?? '30d',
  },

  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  push: {
    expoUrl: process.env.EXPO_PUSH_URL ?? 'https://exp.host/--/api/v2/push/send',
  },

  momo: {
    airtel: {
      // Sandbox par défaut : on ne bascule en production que lorsque
      // la variable est explicitement renseignée. Ce défaut évite
      // qu'une configuration incomplète touche de l'argent réel.
      url: process.env.AIRTEL_API_URL || 'https://openapiuat.airtel.africa',
      clientId: process.env.AIRTEL_CLIENT_ID,
      clientSecret: process.env.AIRTEL_CLIENT_SECRET,
      pin: process.env.AIRTEL_MERCHANT_PIN,
      publicKey: process.env.AIRTEL_PUBLIC_KEY,
    },
    moov: {
      url: process.env.MOOV_API_URL,
      clientId: process.env.MOOV_CLIENT_ID,
      clientSecret: process.env.MOOV_CLIENT_SECRET,
    },
    webhookSecret: process.env.MOMO_WEBHOOK_SECRET ?? 'dev-webhook-secret',
  },
};

// Garde-fou : en production, refuser de démarrer avec les secrets par défaut.
if (config.env === 'production') {
  const weak = ['dev-only-secret', 'dev-only-refresh-secret', 'changez-moi', 'changez-moi-aussi'];
  if (weak.includes(config.jwt.secret) || weak.includes(config.jwt.refreshSecret)) {
    throw new Error('Secrets JWT par défaut détectés en production. Démarrage refusé.');
  }
}
