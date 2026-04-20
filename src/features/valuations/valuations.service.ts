import { PlayerModel } from '../players/players.model.js';
import { LeagueModel } from '../leagues/leagues.model.js';
import type { Player } from '../players/players.types.js';
import type { League } from '../leagues/leagues.types.js';
import type { ValuationQuery, PlayerValuation, ValuationMultipliers } from './valuations.types.js';
import { ApiError } from '@/shared/utils/api-error.js';

// Maps league scoring category names → player stat field names
const BATTING_STAT_MAP: Record<string, string> = {
  AVG: 'ba',
  HR: 'hr',
  RBI: 'rbi',
  BB: 'walk',
  SB: 'sb',
};

const PITCHING_STAT_MAP: Record<string, string> = {
  ERA: 'era',
  W: 'wins',
  SV: 'saves',
  K: 'strikeouts',
  IP: 'innings',
};

// Pitching categories where lower is better (negate z-score)
const PITCHING_LOWER_IS_BETTER = new Set(['ERA', 'WHIP', 'L', 'H', 'BB', 'HR']);

type ScoredPlayer = {
  player: Player;
  avgStats: Record<string, number>;
  rawZSum: number;
};

export class ValuationsService {
  async calculateValuations(leagueId: string, query: ValuationQuery) {
    const league = await LeagueModel.findById(leagueId).lean();
    if (!league) throw new ApiError(404, 'League not found');

    const allPlayers = (await PlayerModel.find({ active: true }).lean()) as unknown as Player[];

    const hitters = allPlayers.filter((p) => p.playerType === 'hitter');
    const pitchers = allPlayers.filter((p) => p.playerType === 'pitcher');

    const hitterAveraged = hitters.map((p) => ({ player: p, avgStats: this.averageStats(p) }));
    const pitcherAveraged = pitchers.map((p) => ({ player: p, avgStats: this.averageStats(p) }));

    const hitterScored = this.computeZScores(
      hitterAveraged,
      league.battingCategories,
      BATTING_STAT_MAP,
      false,
      league,
    );
    const pitcherScored = this.computeZScores(
      pitcherAveraged,
      league.pitchingCategories,
      PITCHING_STAT_MAP,
      true,
      league,
    );

    const numTeams = (league.teams ?? []).length || 10;
    const totalBudget = league.totalBudget ?? 260;
    const hitterBudget = totalBudget * numTeams * 0.67;
    const pitcherBudget = totalBudget * numTeams * 0.33;

    const takenPlayerIds = new Set((league.taken_players ?? []).map(([pid]) => String(pid)));

    const hitterValuations = this.scoreToValuations(
      hitterScored,
      hitterBudget,
      league,
      takenPlayerIds,
      query.teamId,
    );
    const pitcherValuations = this.scoreToValuations(
      pitcherScored,
      pitcherBudget,
      league,
      takenPlayerIds,
      query.teamId,
    );

    let all = [...hitterValuations, ...pitcherValuations].sort(
      (a, b) => b.dollarValue - a.dollarValue,
    );

    if (query.playerType) {
      all = all.filter((v) => v.playerType === query.playerType);
    }

    const total = all.length;
    const start = (query.page - 1) * query.limit;

    return {
      leagueId: String(league._id),
      leagueName: league.name,
      teamId: query.teamId,
      valuations: all.slice(start, start + query.limit),
      pagination: { page: query.page, limit: query.limit, total },
    };
  }

  private averageStats(player: Player): Record<string, number> {
    const relevantStats = (player.stats ?? [])
      .filter((s) => s.type === player.playerType)
      .slice(-3);

    if (relevantStats.length === 0) return {};

    const summed: Record<string, number> = {};
    const counts: Record<string, number> = {};

    for (const stat of relevantStats) {
      for (const [key, val] of Object.entries(stat.data as Record<string, unknown>)) {
        if (typeof val === 'number') {
          summed[key] = (summed[key] ?? 0) + val;
          counts[key] = (counts[key] ?? 0) + 1;
        }
      }
    }

    return Object.fromEntries(Object.keys(summed).map((k) => [k, summed[k] / counts[k]]));
  }

  private computeZScores(
    players: { player: Player; avgStats: Record<string, number> }[],
    categories: string[],
    statMap: Record<string, string>,
    isPitcher: boolean,
    league: League,
  ): ScoredPlayer[] {
    const weights = (league.categoryWeights ?? {}) as Record<string, number>;

    // Collect per-category values across all players to compute population stats
    const catPopulation: Record<string, number[]> = {};
    for (const cat of categories) {
      const key = statMap[cat];
      if (!key) continue;
      catPopulation[cat] = players
        .map(({ avgStats }) => avgStats[key])
        .filter((v): v is number => v !== undefined);
    }

    const catStats: Record<string, { mean: number; std: number }> = {};
    for (const [cat, vals] of Object.entries(catPopulation)) {
      if (vals.length < 2) continue;
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length;
      catStats[cat] = { mean, std: Math.sqrt(variance) };
    }

    return players.map(({ player, avgStats }) => {
      let rawZSum = 0;

      for (const cat of categories) {
        const key = statMap[cat];
        if (!key || !catStats[cat] || catStats[cat].std === 0) continue;

        const val = avgStats[key];
        if (val === undefined) continue;

        let z = (val - catStats[cat].mean) / catStats[cat].std;
        if (isPitcher && PITCHING_LOWER_IS_BETTER.has(cat)) z = -z;

        rawZSum += z * (weights[cat] ?? 1);
      }

      return { player, avgStats, rawZSum };
    });
  }

  private scoreToValuations(
    scored: ScoredPlayer[],
    budget: number,
    league: League,
    takenPlayerIds: Set<string>,
    teamId?: string,
  ): PlayerValuation[] {
    const totalPositive = scored.reduce((acc, { rawZSum }) => acc + Math.max(0, rawZSum), 0);

    return scored.map(({ player, avgStats, rawZSum }) => {
      const baseValue =
        totalPositive > 0 && rawZSum > 0
          ? parseFloat(((rawZSum / totalPositive) * budget).toFixed(2))
          : 1;

      const mult = this.computeMultipliers(player);
      const adjusted = baseValue * mult.depthChart * mult.age * mult.injury;
      const dollarValue = Math.max(1, parseFloat(adjusted.toFixed(2)));

      const { draftable, reason } = this.checkDraftability(
        player,
        league,
        takenPlayerIds,
        teamId,
      );

      return {
        playerId: String(player._id),
        name: player.name,
        team: player.team,
        positions: player.positions,
        playerType: player.playerType,
        age: player.age,
        injuryStatus: player.injuryStatus,
        depthChartStatus: player.depthChartStatus,
        depthChartOrder: player.depthChartOrder,
        averagedStats: avgStats,
        baseValue,
        dollarValue,
        draftable,
        draftableReason: reason,
        multipliers: mult,
      };
    });
  }

  private computeMultipliers(player: Player): ValuationMultipliers {
    // Depth chart order 1 = starter slot, 2 = backup, else = reserve/unknown
    let depthChart: number;
    if (player.depthChartOrder === 1 || player.depthChartStatus === 'starter') {
      depthChart = 1.5;
    } else if (player.depthChartOrder === 2 || player.depthChartStatus === 'backup') {
      depthChart = 1.0;
    } else {
      depthChart = 0.85;
    }

    // Age brackets from diagram: 18-25 → 1.5, 26-34 → 1.0, 35+ → 0.85
    let age = 1.0;
    if (player.age !== undefined) {
      if (player.age <= 25) age = 1.5;
      else if (player.age >= 35) age = 0.85;
    }

    // Injury: active only gets 1.0; any injury status gets 0.2
    const injury = player.injuryStatus === 'active' ? 1.0 : 0.2;

    return { depthChart, age, injury };
  }

  private checkDraftability(
    player: Player,
    league: League,
    takenPlayerIds: Set<string>,
    teamId?: string,
  ): { draftable: boolean; reason?: string } {
    if (takenPlayerIds.has(String(player._id))) {
      return { draftable: false, reason: 'Player has already been drafted' };
    }

    if (teamId && !this.teamHasOpenSlot(player, league, teamId)) {
      return { draftable: false, reason: 'No open roster slot for this position' };
    }

    return { draftable: true };
  }

  private teamHasOpenSlot(player: Player, league: League, teamId: string): boolean {
    const slots = league.rosterSlots as Record<string, number>;
    const teamDrafted = (league.taken_players ?? []).filter(([, tid]) => tid === teamId);

    const occupied: Record<string, number> = {};
    for (const [, , posSlot] of teamDrafted) {
      occupied[posSlot] = (occupied[posSlot] ?? 0) + 1;
    }

    for (const pos of player.positions) {
      if ((occupied[pos] ?? 0) < (slots[pos] ?? 0)) return true;
    }

    // Hitters can fill UTIL slot
    if (player.playerType === 'hitter' && (occupied['UTIL'] ?? 0) < (slots['UTIL'] ?? 0)) {
      return true;
    }

    // Any position can fill BENCH
    if ((occupied['BENCH'] ?? 0) < (slots['BENCH'] ?? 0)) return true;

    return false;
  }
}

export const valuationsService = new ValuationsService();
