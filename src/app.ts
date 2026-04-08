import express from 'express';
import { env } from './config/env.js';
import { connectDB } from './loaders/mongoose.js';
import { loadExpress } from './loaders/express.js';
import { startAgenda } from './loaders/agenda.js';
import {
  definePlayerSyncJob,
  schedulePlayerSync,
} from './jobs/sync-players.job.js';
import {
  defineDepthChartSyncJob,
  scheduleDepthChartSync,
} from './jobs/sync-depth-charts.job.js';
import { seedDefaultLeagues } from './features/leagues/utils/leagues.seed.js';

async function start() {
  const app = express();

  await connectDB();
  await seedDefaultLeagues();
  await startAgenda();
  definePlayerSyncJob();
  await schedulePlayerSync();
  defineDepthChartSyncJob();
  await scheduleDepthChartSync();

  loadExpress(app);

  app.listen(env.port, () => {
    console.log(`Server running on http://localhost:${env.port}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
