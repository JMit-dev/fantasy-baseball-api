import swaggerJsdoc from 'swagger-jsdoc';
import { env } from './env.js';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Fantasy Baseball API',
      version: '1.0.0',
      description:
        'API for fantasy baseball draft recommendations and player data',
    },
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'API key required for protected endpoints',
        },
      },
    },
    security: [{ ApiKeyAuth: [] }],
    servers: env.isProduction
      ? [
          {
            url: 'https://fantasy-baseball-api.onrender.com',
            description: 'Production server',
          },
        ]
      : [
          {
            url: `http://localhost:${env.port}`,
            description: 'Development server',
          },
        ],
  },
  apis: [
    './src/features/**/*.routes.ts',
    './src/features/**/*.types.ts',
    './src/loaders/express.ts',
  ],
};

export const swaggerSpec = swaggerJsdoc(options);
