import mongoose, { Schema } from 'mongoose';
import type { League } from './leagues.types.js';

function isValidTakenPlayers(value: unknown): boolean {
  if (!Array.isArray(value)) return false;

  return value.every(
    (entry) =>
      Array.isArray(entry) &&
      entry.length === 4 &&
      typeof entry[0] === 'string' &&
      typeof entry[1] === 'string' &&
      typeof entry[2] === 'string' &&
      typeof entry[3] === 'number' &&
      entry[3] >= 0,
  );
}

function isValidTeams(value: unknown): boolean {
  if (!Array.isArray(value)) return false;

  return value.every(
    (entry) =>
      Array.isArray(entry) &&
      entry.length === 3 &&
      typeof entry[0] === 'string' &&
      typeof entry[1] === 'string' &&
      typeof entry[2] === 'number' &&
      entry[2] >= 0,
  );
}

const leagueSchema = new Schema<League>(
  {
    externalId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    format: {
      type: String,
      required: true,
      enum: ['roto', 'h2h-points', 'h2h-category'],
    },
    draftType: {
      type: String,
      required: true,
      enum: ['auction', 'snake'],
    },
    battingCategories: {
      type: [String],
      required: true,
      enum: [
        'R',
        'HR',
        'RBI',
        'SB',
        'AVG',
        'OBP',
        'SLG',
        'OPS',
        'H',
        '2B',
        '3B',
        'BB',
        'K',
      ],
    },
    pitchingCategories: {
      type: [String],
      required: true,
      enum: [
        'W',
        'SV',
        'K',
        'ERA',
        'WHIP',
        'QS',
        'IP',
        'H',
        'BB',
        'HR',
        'L',
        'HLD',
        'SV+HLD',
      ],
    },
    rosterSlots: {
      C: { type: Number, default: 1 },
      '1B': { type: Number, default: 1 },
      '2B': { type: Number, default: 1 },
      '3B': { type: Number, default: 1 },
      SS: { type: Number, default: 1 },
      OF: { type: Number, default: 3 },
      DH: { type: Number, default: 0 },
      SP: { type: Number, default: 5 },
      RP: { type: Number, default: 2 },
      UTIL: { type: Number, default: 0 },
      BENCH: { type: Number, default: 0 },
    },
    totalBudget: {
      type: Number,
      min: 1,
    },
    taken_players: {
      type: [[Schema.Types.Mixed]],
      default: [],
      validate: {
        validator: isValidTakenPlayers,
        message:
          'taken_players must be [player_id, team_id, position_slot, price] tuples',
      },
    },
    teams: {
      type: [[Schema.Types.Mixed]],
      default: [],
      validate: {
        validator: isValidTeams,
        message: 'teams must be [team_id, team_name, current_budget] tuples',
      },
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    categoryWeights: {
      type: Map,
      of: Number,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
leagueSchema.index({ name: 'text', description: 'text' });
leagueSchema.index({ format: 1 });
leagueSchema.index({ draftType: 1 });
leagueSchema.index({ isDefault: 1 });

export const LeagueModel = mongoose.model<League>('League', leagueSchema);
