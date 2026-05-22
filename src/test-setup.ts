import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import mongoose from 'mongoose';
import { LeagueModel } from './features/leagues/leagues.model.js';
import { PlayerModel } from './features/players/players.model.js';
import { ServiceApiKeyModel } from './features/api-keys/api-keys.model.js';

beforeAll(async () => {
  process.env.API_KEY_PEPPER =
    process.env.API_KEY_PEPPER || 'test-api-key-pepper';
  const { connectDB } = await import('./loaders/mongoose.js');
  await connectDB();
});

afterEach(async () => {
  await Promise.all([
    PlayerModel.deleteMany({}),
    LeagueModel.deleteMany({}),
    ServiceApiKeyModel.deleteMany({}),
  ]);
  vi.restoreAllMocks();
});

afterAll(async () => {
  await mongoose.connection.close();
});
