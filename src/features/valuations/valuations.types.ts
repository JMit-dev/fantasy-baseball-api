import { z } from 'zod';

export const ValuationQuerySchema = z.object({
  teamId: z.string().optional(),
  playerType: z.enum(['hitter', 'pitcher']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export type ValuationQuery = z.infer<typeof ValuationQuerySchema>;

export interface ValuationMultipliers {
  depthChart: number;
  age: number;
  injury: number;
}

export interface PlayerValuation {
  playerId: string;
  name: string;
  team: string;
  positions: string[];
  playerType: 'hitter' | 'pitcher';
  age?: number;
  injuryStatus: string;
  depthChartStatus?: string;
  depthChartOrder?: number;
  averagedStats: Record<string, number>;
  baseValue: number;
  dollarValue: number;
  draftable: boolean;
  draftableReason?: string;
  multipliers: ValuationMultipliers;
}
