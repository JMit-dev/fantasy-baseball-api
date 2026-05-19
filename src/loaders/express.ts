import express, { type Express, Router } from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { errorHandler } from '../shared/middlewares/error-handler.js';
import { swaggerSpec } from '../config/swagger.js';
import playersRoutes from '../features/players/players.routes.js';
import apiKeysRoutes from '../features/api-keys/api-keys.routes.js';
import valuationsRoutes from '../features/valuations/valuations.routes.js';
import apiKeyRegisterRoute from '../features/api-keys/api-keys.register.routes.js';
import notificationsRoutes from '../features/notifications/notifications.routes.js';
import { createRequireApiKey } from '../shared/middlewares/require-api-key.js';
import { apiKeysService } from '../features/api-keys/api-keys.service.js';
import { env } from '../config/env.js';
import { createRateLimitMiddleware } from '../shared/middlewares/rate-limit.js';

function createNoopMiddleware(): express.RequestHandler {
  return (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => next();
}

function createPerKeyRateLimiter(): express.RequestHandler {
  return createRateLimitMiddleware({
    windowMs: 60 * 1000,
    limit: (req) =>
      req.apiClient?.effectiveRateLimitPerMinute ??
      env.apiKeyRateLimitPerMinute,
    keyGenerator: (req) => req.apiClient?.keyId || 'missing-api-client',
    message: { message: 'Too many requests, please try again later.' },
  });
}

export function loadExpress(app: Express): void {
  const requireApiKey = createRequireApiKey(
    apiKeysService.authenticateApiKey.bind(apiKeysService),
  );
  const apiKeyMiddleware = env.disableApiKeyAuth
    ? createNoopMiddleware()
    : requireApiKey;
  const perKeyRateLimitMiddleware = env.disableApiKeyAuth
    ? createNoopMiddleware()
    : createPerKeyRateLimiter();

  app.use(cors());
  app.use(express.json());

  // Global rate limit: 200 requests per minute per IP
  app.use(
    createRateLimitMiddleware({
      windowMs: 60 * 1000,
      limit: 200,
      message: { message: 'Too many requests, please try again later.' },
    }),
  );

  // Stricter limit on the public registration endpoint: 10 per hour per IP
  app.use(
    '/api/register',
    createRateLimitMiddleware({
      windowMs: 60 * 60 * 1000,
      limit: 10,
      message: {
        message: 'Too many registration attempts, please try again later.',
      },
    }),
  );

  // Swagger API documentation
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  // Health check
  const health = Router();
  /**
   * @swagger
   * /api/health:
   *   get:
   *     summary: Health check endpoint
   *     tags: [Health]
   *     security: []
   *     responses:
   *       200:
   *         description: Service is healthy
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 status:
   *                   type: string
   *                   example: ok
   */
  health.get('/', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/health', health);

  // Public: self-service API key registration (no auth required)
  app.use('/api/register', apiKeyRegisterRoute);

  // Feature routes
  app.use('/api/api-keys', apiKeyMiddleware, apiKeysRoutes);
  app.use(
    '/api/players',
    apiKeyMiddleware,
    perKeyRateLimitMiddleware,
    playersRoutes,
  );
  app.use(
    '/api/valuations',
    apiKeyMiddleware,
    perKeyRateLimitMiddleware,
    valuationsRoutes,
  );
  app.use('/api', apiKeyMiddleware, notificationsRoutes);

  app.use(errorHandler);
}
