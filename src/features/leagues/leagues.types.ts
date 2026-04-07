import { z } from 'zod';

// Roster slot configuration
export const RosterSlotsSchema = z.object({
  C: z.number().int().min(0).default(1),
  '1B': z.number().int().min(0).default(1),
  '2B': z.number().int().min(0).default(1),
  '3B': z.number().int().min(0).default(1),
  SS: z.number().int().min(0).default(1),
  OF: z.number().int().min(0).default(3),
  DH: z.number().int().min(0).default(0),
  SP: z.number().int().min(0).default(5),
  RP: z.number().int().min(0).default(2),
  UTIL: z.number().int().min(0).default(0),
  BENCH: z.number().int().min(0).default(0),
});

// Scoring categories
export const BattingCategorySchema = z.enum([
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
]);

export const PitchingCategorySchema = z.enum([
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
]);

// League format types
export const LeagueFormatSchema = z.enum([
  'roto',
  'h2h-points',
  'h2h-category',
]);

// Draft type
export const DraftTypeSchema = z.enum(['auction', 'snake']);

export const TakenPlayerSchema = z.tuple([
  z.string(),
  z.string(),
  z.string(),
  z.number().min(0),
]);

export const LeagueTeamSchema = z.tuple([
  z.string(),
  z.string(),
  z.number().min(0),
]);

// League schema
export const LeagueSchema = z.object({
  externalId: z.string().min(1), // Unique identifier for upserting
  name: z.string().min(1).trim(),
  description: z.string().optional(),
  format: LeagueFormatSchema,
  draftType: DraftTypeSchema,
  battingCategories: z.array(BattingCategorySchema).min(1),
  pitchingCategories: z.array(PitchingCategorySchema).min(1),
  rosterSlots: RosterSlotsSchema,
  totalBudget: z.number().int().min(1).optional(),
  taken_players: z.array(TakenPlayerSchema).optional(),
  teams: z.array(LeagueTeamSchema).optional(),
  isDefault: z.boolean().default(false),
  categoryWeights: z.record(z.string(), z.number()).optional(),
});

// Filters for querying leagues
export const LeagueFiltersSchema = z.object({
  format: LeagueFormatSchema.optional(),
  draftType: DraftTypeSchema.optional(),
  isDefault: z.coerce.boolean().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

// Infer TypeScript types
export type RosterSlots = z.infer<typeof RosterSlotsSchema>;
export type BattingCategory = z.infer<typeof BattingCategorySchema>;
export type PitchingCategory = z.infer<typeof PitchingCategorySchema>;
export type LeagueFormat = z.infer<typeof LeagueFormatSchema>;
export type DraftType = z.infer<typeof DraftTypeSchema>;
export type TakenPlayer = z.infer<typeof TakenPlayerSchema>;
export type LeagueTeam = z.infer<typeof LeagueTeamSchema>;
export type LeagueInput = z.infer<typeof LeagueSchema>;
export type LeagueFilters = z.infer<typeof LeagueFiltersSchema>;

// Database document type (includes Mongoose fields)
export interface League extends LeagueInput {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
}
