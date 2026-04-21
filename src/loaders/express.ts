import express, { type Express, Router } from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { errorHandler } from '../shared/middlewares/error-handler.js';
import { swaggerSpec } from '../config/swagger.js';
import playersRoutes from '../features/players/players.routes.js';
import leaguesRoutes from '../features/leagues/leagues.routes.js';
import apiKeysRoutes from '../features/api-keys/api-keys.routes.js';
import valuationsRoutes from '../features/valuations/valuations.routes.js';
import { createRequireApiKey } from '../shared/middlewares/require-api-key.js';
import { apiKeysService } from '../features/api-keys/api-keys.service.js';
import { env } from '../config/env.js';

export function loadExpress(app: Express): void {
  const requireApiKey = createRequireApiKey(
    apiKeysService.authenticateApiKey.bind(apiKeysService),
  );
  const apiKeyMiddleware = env.disableApiKeyAuth
    ? (
        _req: express.Request,
        _res: express.Response,
        next: express.NextFunction,
      ) => next()
    : requireApiKey;

  app.use(cors());
  app.use(express.json());

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

  // Feature routes
  app.use('/api/api-keys', apiKeyMiddleware, apiKeysRoutes);
  app.use('/api/players', apiKeyMiddleware, playersRoutes);
  app.use('/api/leagues', apiKeyMiddleware, leaguesRoutes);
  app.use('/api/valuations', apiKeyMiddleware, valuationsRoutes);

  app.use(errorHandler);
}
