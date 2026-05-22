import { PlayerModel } from '../players/players.model.js';
import { LeagueModel } from '../leagues/leagues.model.js';
import type { Player } from '../players/players.types.js';
import type {
  DraftPick,
  League,
  TakenPlayer,
} from '../leagues/leagues.types.js';
import type {
  ValuationLeague,
  ValuationQuery,
  PlayerValuation,
  ValuationMultipliers,
} from './valuations.types.js';
import { ApiError } from '@/shared/utils/api-error.js';
import { logger } from '@/shared/utils/logger.js';
import { ROOKIE_AVERAGES } from './rookie-averages.js';

// Maps league scoring category names → player stat field names
const BATTING_STAT_MAP: Record<string, string> = {
  AVG: 'ba',
  HR: 'hr',
  RBI: 'rbi',
  BB: 'walk',
  SB: 'sb',
  R: 'r',
};

const PITCHING_STAT_MAP: Record<string, string> = {
  ERA: 'era',
  W: 'wins',
  SV: 'saves',
  K: 'strikeouts',
  IP: 'innings',
  WHIP: 'whip',
};

// Pitching categories where lower is better (negate z-score)
const PITCHING_LOWER_IS_BETTER = new Set(['ERA', 'WHIP', 'L', 'H', 'BB', 'HR']);

type ScoredPlayer = {
  player: Player;
  avgStats: Record<string, number>;
  rawZSum: number;
};

type SlotCounts = Record<string, number>;

type PositionGroup = {
  key: string;
  totalRoots: string[];
};

type HitterReplacementGroup = {
  key: string;
  demand: number;
  eligible: (player: Player) => boolean;
};

function normalizePlayerReference(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseSlotRoot(slot: string): string {
  return slot.split('-')[0] ?? slot;
}

function getMaxPositive(values: number[]): number {
  return values.reduce((max, value) => (value > max ? value : max), 0);
}

function buildSlotCounts(league: League, numTeams: number): SlotCounts {
  const slots = (league.rosterSlots ?? {}) as Record<string, number>;
  const counts: SlotCounts = {};

  for (const [slot, count] of Object.entries(slots)) {
    counts[slot] = (count ?? 0) * numTeams;
  }

  return counts;
}

function getBaselineScore(sortedScores: number[], demand: number): number {
  if (demand <= 0 || sortedScores.length === 0) return Number.POSITIVE_INFINITY;
  const replacementIndex = Math.min(demand, sortedScores.length - 1);
  return sortedScores[replacementIndex] ?? 0;
}

const HITTER_CATEGORY_DAMPING: Record<string, number> = {
  AVG: 0.95,
  BB: 0.9,
  SB: 0.3,
};

const HITTER_GLOBAL_FLOOR_WEIGHT = 0.5;
const HITTER_REPLACEMENT_DEMAND_MULTIPLIER = 1.05;
const HITTER_MARKET_FACTOR = 1.02;
const PITCHER_GLOBAL_FLOOR_WEIGHT = 0.2;
const PITCHER_REPLACEMENT_DEMAND_MULTIPLIER = 1.05;
const MIN_RP_BUDGET_SHARE = 0.3;
const PITCHER_ROLE_BASE_FACTORS: Record<'SP' | 'RP', number> = {
  SP: 100.35,
  RP: 300.0,
};
const HITTER_POSITION_MARKET_FACTORS: Record<string, number> = {
  C: 1.0,
  '1B': 1.12,
  '2B': 1.08,
  '3B': 1.08,
  SS: 1.08,
  OF: 1.08,
  DH: 0.95,
};

export class ValuationsService {
  async calculateValuations(leagueId: string, query: ValuationQuery) {
    const league = await LeagueModel.findById(leagueId).lean();
    if (!league) throw new ApiError(404, 'League not found');

    return {
      leagueId: String(league._id),
      ...(await this.buildValuationsForLeague(league, query)),
    };
  }

  async calculateValuationsForLeague(
    league: ValuationLeague,
    query: ValuationQuery,
  ) {
    const normalizedLeague = await this.normalizeLeaguePlayerReferences(
      league as League,
    );
    return this.buildValuationsForLeague(normalizedLeague, query);
  }

  private async normalizeLeaguePlayerReferences(
    league: League,
  ): Promise<League> {
    const takenPlayers = league.taken_players ?? [];
    const draftPicks = league.draft_picks ?? [];

    if (takenPlayers.length === 0 && draftPicks.length === 0) {
      return league;
    }

    const allPlayers = (await PlayerModel.find({})
      .select('_id name')
      .lean()) as Array<Pick<Player, '_id' | 'name'>>;

    const validIds = new Set(allPlayers.map((player) => String(player._id)));
    const playersByNormalizedName = new Map<string, string[]>();

    for (const player of allPlayers) {
      const normalizedName = normalizePlayerReference(player.name);
      const matches = playersByNormalizedName.get(normalizedName) ?? [];
      matches.push(String(player._id));
      playersByNormalizedName.set(normalizedName, matches);
    }

    const unresolved = new Set<string>();
    const ambiguous = new Set<string>();

    const resolvePlayerRef = (value: string): string => {
      if (validIds.has(value)) return value;

      const normalizedName = normalizePlayerReference(value);
      const matches = playersByNormalizedName.get(normalizedName) ?? [];

      if (matches.length === 1) return matches[0];
      if (matches.length === 0) unresolved.add(value);
      else ambiguous.add(value);

      return value;
    };

    const normalizedTakenPlayers = takenPlayers.map(
      ([playerRef, teamId, slot, price, contract]) =>
        [
          resolvePlayerRef(String(playerRef)),
          teamId,
          slot,
          price,
          contract,
        ] as TakenPlayer,
    );

    const normalizedDraftPicks = draftPicks.map(
      ([pickNumber, nominatingTeamId, winningTeamId, playerRef, salary]) =>
        [
          pickNumber,
          nominatingTeamId,
          winningTeamId,
          resolvePlayerRef(String(playerRef)),
          salary,
        ] as DraftPick,
    );

    if (unresolved.size > 0 || ambiguous.size > 0) {
      const parts: string[] = [];
      if (unresolved.size > 0) {
        parts.push(
          `Unknown player references: ${Array.from(unresolved).sort().join(', ')}`,
        );
      }
      if (ambiguous.size > 0) {
        parts.push(
          `Ambiguous player references: ${Array.from(ambiguous).sort().join(', ')}`,
        );
      }
      throw new ApiError(400, parts.join('. '));
    }

    return {
      ...league,
      taken_players: normalizedTakenPlayers,
      draft_picks: normalizedDraftPicks,
    };
  }

  private async buildValuationsForLeague(
    league: League,
    query: ValuationQuery,
  ) {
    const allPlayers = (await PlayerModel.find({
      active: true,
    }).lean()) as unknown as Player[];

    const hitters = allPlayers.filter((p) => p.playerType === 'hitter');
    const pitchers = allPlayers.filter((p) => p.playerType === 'pitcher');

    const hitterAveraged = hitters.map((p) => ({
      player: p,
      avgStats: this.averageStats(p),
    }));
    const pitcherAveraged = pitchers.map((p) => ({
      player: p,
      avgStats: this.averageStats(p),
    }));

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

    const slotCounts = buildSlotCounts(league, numTeams);

    console.log('ROSTER_SLOTS', league.rosterSlots);

    console.log('SLOT_COUNTS', slotCounts);
    const hitterSlots = this.countHitterDemandSlots(slotCounts);
    const pitcherSlots = this.countPitcherDemandSlots(slotCounts);
    const totalPositionSlots = hitterSlots + pitcherSlots;
    const hitterFraction =
      totalPositionSlots > 0 ? hitterSlots / totalPositionSlots : 0.67;

    const hitterBudget = totalBudget * numTeams * hitterFraction;
    const pitcherBudget = totalBudget * numTeams * (1 - hitterFraction);

    const debugLeagueBudget = {
      numTeams,
      totalBudget,
      hitterSlots,
      pitcherSlots,
      totalPositionSlots,
      hitterFraction,
      hitterBudget,
      pitcherBudget,
    };

    const takenPlayerIds = new Set(
      (league.taken_players ?? []).map(([pid]) => String(pid)),
    );
    const scarcityMap = this.buildScarcityMap(league, numTeams);
    const hitterReplacementValues = this.buildHitterReplacementValues(
      hitterScored,
      slotCounts,
    );
    const pitcherReplacementValues = this.buildPitcherReplacementValues(
      pitcherScored,
      slotCounts,
    );

    // Diagnostic: expose top-50 pitcher replacement values for debugging
    const replacementEntries = [...pitcherReplacementValues.entries()];

    console.log('\n===== TOP 50 PITCHER REPLACEMENT VALUES =====');

    replacementEntries
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .forEach(([playerId, score], index) => {
        const player = pitcherScored.find(
          (p) => String(p.player._id) === playerId,
        );

        console.log({
          rank: index + 1,
          player: player?.player?.name,
          positions: player?.player?.positions,
          rawZSum: player?.rawZSum,
          replacementValue: score,
        });
      });

    console.log('===== END TOP 50 =====\n');

    const debugPitcherReplacementTop50 = replacementEntries
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([playerId, score], index) => ({
        rank: index + 1,
        playerId,
        playerName: pitcherScored.find((p) => String(p.player._id) === playerId)
          ?.player?.name,
        positions: pitcherScored.find((p) => String(p.player._id) === playerId)
          ?.player?.positions,
        rawZSum: pitcherScored.find((p) => String(p.player._id) === playerId)
          ?.rawZSum,
        replacementValue: score,
      }));

    const hitterValuations = this.scoreToValuations(
      hitterScored,
      hitterBudget,
      league,
      takenPlayerIds,
      scarcityMap,
      query.teamId,
      hitterReplacementValues,
    );

    const pitcherValuations = this.scoreToValuations(
      pitcherScored,
      pitcherBudget,
      league,
      takenPlayerIds,
      scarcityMap,
      query.teamId,
      pitcherReplacementValues,
    );

    let all = [...hitterValuations, ...pitcherValuations].sort(
      (a, b) => b.dollarValue - a.dollarValue,
    );

    if (query.playerType) {
      all = all.filter((v) => v.playerType === query.playerType);
    }

    if (query.name) {
      const search = query.name.toLowerCase();
      all = all.filter((v) => v.name.toLowerCase().includes(search));
    }

    const total = all.length;
    const start = (query.page - 1) * query.limit;

    return {
      leagueName: league.name,
      teamId: query.teamId,
      valuations: all.slice(start, start + query.limit),
      pagination: { page: query.page, limit: query.limit, total },
      debugPitcherReplacementTop50,
      debugPitcherReplacementBreakdowns:
        (this as any).lastPitcherReplacementBreakdowns ?? [],
      debugRolePositiveTotals: (this as any).lastRolePositiveTotals ?? null,
      debugLeagueBudget,
    };
  }

  private static readonly TARGET_SEASONS = ['2023', '2024'] as const;
  private static readonly SEASON_WEIGHTS: Record<string, number> = {
    '2023': 0.4,
    '2024': 0.6,
  };

  private averageStats(player: Player): Record<string, number> {
    const primaryPosition = player.positions?.[0] ?? '';

    const statsBySeason: Record<string, Record<string, number>> = {};
    for (const stat of (player.stats ?? []).filter(
      (s) => s.type === player.playerType,
    )) {
      const data: Record<string, number> = {};
      for (const [key, val] of Object.entries(
        (stat.data ?? {}) as Record<string, unknown>,
      )) {
        if (typeof val === 'number') data[key] = val;
      }
      statsBySeason[String(stat.season)] = data;
    }

    const seasons = ValuationsService.TARGET_SEASONS.map((year) => ({
      data:
        statsBySeason[year] ??
        (ROOKIE_AVERAGES[year]?.[
          primaryPosition as keyof (typeof ROOKIE_AVERAGES)[typeof year]
        ] as Record<string, number> | undefined) ??
        {},
      weight: ValuationsService.SEASON_WEIGHTS[year],
    }));

    const allKeys = new Set(seasons.flatMap((s) => Object.keys(s.data)));
    if (allKeys.size === 0) return {};

    const result: Record<string, number> = {};
    for (const key of allKeys) {
      let weightedSum = 0;
      let usedWeight = 0;
      for (const { data, weight } of seasons) {
        const val = data[key];
        if (typeof val === 'number') {
          weightedSum += val * weight;
          usedWeight += weight;
        }
      }
      if (usedWeight > 0) result[key] = weightedSum / usedWeight;
    }
    return result;
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
      const variance =
        vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length;
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

        const damping = !isPitcher ? (HITTER_CATEGORY_DAMPING[cat] ?? 1) : 1;
        rawZSum += z * (weights[cat] ?? 1) * damping;
      }

      if (isPitcher) {
        try {
          logger.debug('computeZScores: pitcher rawZSum', {
            playerId: String(player._id),
            name: player.name,
            rawZSum,
            avgStats,
          });
        } catch (e) {
          // swallow logging errors
        }
      }

      return { player, avgStats, rawZSum };
    });
  }

  private countHitterDemandSlots(slotCounts: SlotCounts): number {
    const keys = ['C', '1B', '2B', '3B', 'SS', 'CI', 'MI', 'OF', 'DH', 'UTIL'];

    return keys.reduce((sum, key) => sum + (slotCounts[key] ?? 0), 0);
  }

  private countPitcherDemandSlots(slotCounts: SlotCounts): number {
    const keys = ['SP', 'RP', 'P'];
    return keys.reduce((sum, key) => sum + (slotCounts[key] ?? 0), 0);
  }

  private buildHitterReplacementValues(
    scored: ScoredPlayer[],
    slotCounts: SlotCounts,
  ): Map<string, number> {
    const groups: HitterReplacementGroup[] = [
      {
        key: 'C',
        demand: Math.ceil(
          (slotCounts.C ?? 0) * HITTER_REPLACEMENT_DEMAND_MULTIPLIER,
        ),
        eligible: (player: Player) => player.positions.includes('C'),
      },
      {
        key: 'CORNER',
        demand: Math.ceil(
          ((slotCounts['1B'] ?? 0) +
            (slotCounts['3B'] ?? 0) +
            (slotCounts.CI ?? 0)) *
            HITTER_REPLACEMENT_DEMAND_MULTIPLIER,
        ),
        eligible: (player: Player) =>
          player.positions.includes('1B') || player.positions.includes('3B'),
      },
      {
        key: 'MIDDLE',
        demand: Math.ceil(
          ((slotCounts['2B'] ?? 0) +
            (slotCounts.SS ?? 0) +
            (slotCounts.MI ?? 0)) *
            HITTER_REPLACEMENT_DEMAND_MULTIPLIER,
        ),
        eligible: (player: Player) =>
          player.positions.includes('2B') || player.positions.includes('SS'),
      },
      {
        key: 'OF',
        demand: Math.ceil(
          (slotCounts.OF ?? 0) * HITTER_REPLACEMENT_DEMAND_MULTIPLIER,
        ),
        eligible: (player: Player) => player.positions.includes('OF'),
      },
      {
        key: 'BAT',
        demand: Math.ceil(
          ((slotCounts.DH ?? 0) +
            (slotCounts.UTIL ?? 0) +
            Math.ceil(
              ((slotCounts['1B'] ?? 0) +
                (slotCounts['2B'] ?? 0) +
                (slotCounts['3B'] ?? 0) +
                (slotCounts.SS ?? 0) +
                (slotCounts.OF ?? 0)) *
                0.15,
            )) *
            HITTER_REPLACEMENT_DEMAND_MULTIPLIER,
        ),
        eligible: (player: Player) => player.playerType === 'hitter',
      },
    ].filter((group) => group.demand > 0);

    const playerGroups = new Map<string, string[]>();
    playerGroups.set('C', ['C', 'BAT']);
    playerGroups.set('1B', ['CORNER', 'BAT']);
    playerGroups.set('3B', ['CORNER', 'BAT']);
    playerGroups.set('2B', ['MIDDLE', 'BAT']);
    playerGroups.set('SS', ['MIDDLE', 'BAT']);
    playerGroups.set('OF', ['OF', 'BAT']);
    playerGroups.set('DH', ['BAT']);

    const groupBaselines = new Map<string, number>();

    for (const group of groups) {
      const eligible = scored
        .filter(({ player }) => group.eligible(player))
        .map((entry) => entry.rawZSum)
        .sort((a, b) => b - a);

      groupBaselines.set(group.key, getBaselineScore(eligible, group.demand));
    }

    const replacementValues = new Map<string, number>();

    for (const entry of scored) {
      const eligibleGroupKeys = new Set<string>();
      for (const position of entry.player.positions) {
        for (const groupKey of playerGroups.get(position) ?? []) {
          eligibleGroupKeys.add(groupKey);
        }
      }

      if (eligibleGroupKeys.size === 0) {
        eligibleGroupKeys.add('BAT');
      }

      const eligibleDiffs = Array.from(eligibleGroupKeys)
        .filter((groupKey) => groupBaselines.has(groupKey))
        .map((groupKey) => entry.rawZSum - (groupBaselines.get(groupKey) ?? 0));

      const replacementScore = getMaxPositive(eligibleDiffs);
      const globalFloorScore =
        Math.max(0, entry.rawZSum) * HITTER_GLOBAL_FLOOR_WEIGHT;

      replacementValues.set(
        String(entry.player._id),
        Math.max(replacementScore, globalFloorScore),
      );
    }

    return replacementValues;
  }

  private buildPitcherReplacementValues(
    scored: ScoredPlayer[],
    slotCounts: SlotCounts,
  ): Map<string, number> {
    const replacementBreakdowns: Array<Record<string, unknown>> = [];
    const sortedOverallScores = scored
      .map((entry) => entry.rawZSum)
      .sort((a, b) => b - a);
    const overallBaseline = getBaselineScore(
      sortedOverallScores,
      Math.ceil(
        this.countPitcherDemandSlots(slotCounts) *
          PITCHER_REPLACEMENT_DEMAND_MULTIPLIER,
      ),
    );

    const starterBaseline = getBaselineScore(
      scored
        .filter(({ player, avgStats }) =>
          this.getEffectivePositions(player, avgStats).includes('SP'),
        )
        .map((entry) => entry.rawZSum)
        .sort((a, b) => b - a),
      Math.ceil(
        ((slotCounts.SP ?? 0) + (slotCounts.P ?? 0) * 0.7) *
          PITCHER_REPLACEMENT_DEMAND_MULTIPLIER,
      ),
    );

    const relieverBaseline = getBaselineScore(
      scored
        .filter(({ player, avgStats }) =>
          this.getEffectivePositions(player, avgStats).includes('RP'),
        )
        .map((entry) => entry.rawZSum)
        .sort((a, b) => b - a),
      Math.ceil(
        ((slotCounts.RP ?? 0) + (slotCounts.P ?? 0) * 0.3) *
          PITCHER_REPLACEMENT_DEMAND_MULTIPLIER,
      ),
    );

    const replacementValues = new Map<string, number>();

    for (const entry of scored) {
      const effectivePositions = this.getEffectivePositions(
        entry.player,
        entry.avgStats,
      );
      const roleDiffs: number[] = [entry.rawZSum - overallBaseline];

      if (effectivePositions.includes('SP')) {
        roleDiffs.push(entry.rawZSum - starterBaseline);
      }
      if (effectivePositions.includes('RP')) {
        roleDiffs.push(entry.rawZSum - relieverBaseline);
      }

      const replacementScore = getMaxPositive(roleDiffs);
      try {
        console.log('REPLACEMENT_SCORE_INPUT', {
          player: entry.player.name,
          rawZSum: entry.rawZSum,
          replacementScore,
        });
      } catch (e) {
        // ignore logging errors
      }
      try {
        replacementBreakdowns.push({
          player: entry.player.name,
          rawZSum: entry.rawZSum,
          replacementScore,
        });
      } catch (e) {
        // ignore
      }
      const globalFloorScore =
        Math.max(0, entry.rawZSum) * PITCHER_GLOBAL_FLOOR_WEIGHT;
      const roleBaseFactor = Math.max(
        1.0,
        ...effectivePositions.map((position) =>
          position === 'SP' || position === 'RP'
            ? PITCHER_ROLE_BASE_FACTORS[position]
            : 1.0,
        ),
      );
      const relieverSavesBoost = effectivePositions.includes('RP')
        ? 1 + Math.min(2.5, (entry.avgStats.saves ?? 0) / 6)
        : 1.0;

      if (
        [
          'Robert Suarez',
          'Josh Hader',
          'Jhoan Duran',
          'Mason Miller',
          'Tarik Skubal',
          'Freddy Peralta',
          'Zack Wheeler',
        ].includes(entry.player.name)
      ) {
        console.log('REPLACEMENT_BREAKDOWN', {
          player: entry.player.name,
          rawZSum: entry.rawZSum,
          replacementScore,
          globalFloorScore,
          roleBaseFactor,
          relieverSavesBoost,
          finalReplacementValue:
            Math.max(replacementScore, globalFloorScore) *
            roleBaseFactor *
            relieverSavesBoost,
        });
        try {
          replacementBreakdowns.push({
            player: entry.player.name,
            rawZSum: entry.rawZSum,
            replacementScore,
            globalFloorScore,
            roleBaseFactor,
            relieverSavesBoost,
            finalReplacementValue:
              Math.max(replacementScore, globalFloorScore) *
              roleBaseFactor *
              relieverSavesBoost,
          });
        } catch (e) {
          // ignore
        }
      }

      // Temporarily remove RP/SP inflation to test effect
      replacementValues.set(
        String(entry.player._id),
        Math.max(replacementScore, globalFloorScore),
      );
    }

    // expose breakdowns for debug consumers
    (this as any).lastPitcherReplacementBreakdowns = replacementBreakdowns;

    return replacementValues;
  }

  private getEffectivePositions(
    player: Player,
    avgStats: Record<string, number>,
  ): string[] {
    if (player.playerType !== 'pitcher') {
      return player.positions;
    }

    const declared = player.positions.filter(
      (position): position is 'SP' | 'RP' =>
        position === 'SP' || position === 'RP',
    );

    if (declared.length === 2) {
      return ['SP', 'RP'];
    }

    const saves = avgStats.saves ?? 0;
    const innings = avgStats.innings ?? 0;
    const wins = avgStats.wins ?? 0;
    const inferredReliever =
      saves >= 8 || (saves >= 3 && innings > 0 && innings <= 95);
    const inferredStarter = innings >= 120 || wins >= 8;

    if (declared.length === 1) {
      if (declared[0] === 'SP' && inferredReliever && !inferredStarter) {
        return ['RP'];
      }
      if (declared[0] === 'RP' && inferredStarter && !inferredReliever) {
        return ['SP'];
      }
      return declared;
    }

    if (inferredReliever && !inferredStarter) {
      return ['RP'];
    }

    return ['SP'];
  }

  private buildScarcityMap(
    league: League,
    numTeams: number,
  ): Map<string, number> {
    const totalSlots = buildSlotCounts(league, numTeams);
    const occupiedRoots: SlotCounts = {};

    for (const [, , slot] of league.taken_players ?? []) {
      const root = parseSlotRoot(slot);
      occupiedRoots[root] = (occupiedRoots[root] ?? 0) + 1;
    }

    const groups: PositionGroup[] = [
      { key: 'C', totalRoots: ['C', 'UTIL'] },
      { key: '1B', totalRoots: ['1B', 'CI', 'UTIL'] },
      { key: '2B', totalRoots: ['2B', 'MI', 'UTIL'] },
      { key: '3B', totalRoots: ['3B', 'CI', 'UTIL'] },
      { key: 'SS', totalRoots: ['SS', 'MI', 'UTIL'] },
      { key: 'OF', totalRoots: ['OF', 'UTIL'] },
      { key: 'DH', totalRoots: ['DH', 'UTIL'] },
      { key: 'SP', totalRoots: ['SP', 'P'] },
      { key: 'RP', totalRoots: ['RP', 'P'] },
    ];

    const scarcity = new Map<string, number>();

    for (const group of groups) {
      const total = group.totalRoots.reduce(
        (sum, root) => sum + (totalSlots[root] ?? 0),
        0,
      );
      if (total <= 0) {
        scarcity.set(group.key, 1.0);
        continue;
      }

      const occupied = group.totalRoots.reduce(
        (sum, root) => sum + (occupiedRoots[root] ?? 0),
        0,
      );
      const saturation = Math.max(0, Math.min(1, occupied / total));
      scarcity.set(group.key, parseFloat((1 + saturation * 0.15).toFixed(3)));
    }

    return scarcity;
  }

  private scoreToValuations(
    scored: ScoredPlayer[],
    budget: number,
    league: League,
    takenPlayerIds: Set<string>,
    scarcityMap: Map<string, number>,
    teamId?: string,
    overridePositiveScores?: Map<string, number>,
  ): PlayerValuation[] {
    const getPositiveScore = ({ player, rawZSum }: ScoredPlayer) =>
      Math.max(0, overridePositiveScores?.get(String(player._id)) ?? rawZSum);

    const isPitcherPool = scored.some(
      ({ player }) => player.playerType === 'pitcher',
    );
    const totalPositive = scored.reduce(
      (acc, scoredPlayer) => acc + getPositiveScore(scoredPlayer),
      0,
    );

    const roleBudgetShares = (() => {
      if (!isPitcherPool) {
        return { SP: 1, RP: 0 };
      }
      const numTeams = (league.teams ?? []).length || 10;
      const slotCounts = buildSlotCounts(league, numTeams);
      const spDemand =
        (slotCounts.SP ?? 0) + Math.ceil((slotCounts.P ?? 0) * 0.7);
      const rpDemand =
        (slotCounts.RP ?? 0) +
        Math.max(2, Math.ceil((slotCounts.P ?? 0) * 0.3));
      const totalDemand = spDemand + rpDemand;
      if (totalDemand <= 0) {
        return { SP: 0.6, RP: 0.4 };
      }
      const rawRpShare = rpDemand / totalDemand;
      const rpShare = Math.max(MIN_RP_BUDGET_SHARE, rawRpShare);
      return { SP: 1 - rpShare, RP: rpShare };
    })();

    const rolePositiveTotals = (() => {
      if (!isPitcherPool) {
        return { SP: totalPositive, RP: 0 };
      }

      const totals = { SP: 0, RP: 0 };
      for (const scoredPlayer of scored) {
        const positiveScore = getPositiveScore(scoredPlayer);
        const role = this.getPitcherBudgetRole(
          scoredPlayer.player,
          scoredPlayer.avgStats,
        );
        totals[role] += positiveScore;
      }
      return totals;
    })();

    // expose role positive totals for debugging
    (this as any).lastRolePositiveTotals = rolePositiveTotals;

    return scored.map(({ player, avgStats, rawZSum }) => {
      const positiveScore = getPositiveScore({ player, avgStats, rawZSum });
      const pitcherRole = isPitcherPool
        ? this.getPitcherBudgetRole(player, avgStats)
        : null;
      const roleBudget =
        pitcherRole === 'SP'
          ? budget * roleBudgetShares.SP
          : pitcherRole === 'RP'
            ? budget * roleBudgetShares.RP
            : budget;
      const roleTotalPositive =
        pitcherRole === 'SP'
          ? rolePositiveTotals.SP
          : pitcherRole === 'RP'
            ? rolePositiveTotals.RP
            : totalPositive;
      const baseValue =
        roleTotalPositive > 0 && positiveScore > 0
          ? parseFloat(
              ((positiveScore / roleTotalPositive) * roleBudget).toFixed(2),
            )
          : 1;

      const effectivePositions = this.getEffectivePositions(player, avgStats);
      const scarcity = Math.max(
        1.0,
        ...effectivePositions.map((pos) => scarcityMap.get(pos) ?? 1.0),
      );
      const mult = this.computeMultipliers(player, avgStats);
      const marketFactor =
        player.playerType === 'hitter' ? HITTER_MARKET_FACTOR : 1.0;
      const positionFactor =
        player.playerType === 'hitter'
          ? Math.max(
              1.0,
              ...player.positions.map(
                (position) => HITTER_POSITION_MARKET_FACTORS[position] ?? 1.0,
              ),
            )
          : 1.0;
      try {
        console.log('BASE_VALUE_DEBUG', {
          player: player.name,
          positiveScore,
          roleTotalPositive,
          roleBudget,
          rawCalculation:
            roleTotalPositive > 0 && positiveScore > 0
              ? (positiveScore / roleTotalPositive) * roleBudget
              : null,
          baseValue,
        });
      } catch (e) {
        // ignore logging errors
      }

      const adjusted =
        baseValue * scarcity * mult.depthChart * mult.age * mult.injury;
      const dollarValue = Math.max(
        1,
        parseFloat((adjusted * marketFactor * positionFactor).toFixed(2)),
      );

      if (player.playerType === 'pitcher') {
        try {
          logger.debug('valuation-debug: pitcher', {
            playerId: String(player._id),
            name: player.name,
            rawZSum,
            positiveScore,
            pitcherRole,
            roleBudget: Number(roleBudget),
            roleTotalPositive,
            baseValue,
            scarcity,
            multipliers: mult,
            adjusted,
            dollarValue,
          });
        } catch (e) {
          // ignore logging failures
        }
      }

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
        debug: {
          positiveScore,
          roleTotalPositive,
          roleBudget,
          rawCalculation:
            roleTotalPositive > 0 && positiveScore > 0
              ? (positiveScore / roleTotalPositive) * roleBudget
              : null,
          baseValue,
        },
        draftable,
        draftableReason: reason,
        multipliers: { ...mult, scarcity: parseFloat(scarcity.toFixed(3)) },
      };
    });
  }

  private getPitcherBudgetRole(
    player: Player,
    avgStats: Record<string, number>,
  ): 'SP' | 'RP' {
    const effectivePositions = this.getEffectivePositions(player, avgStats);
    if (
      effectivePositions.includes('RP') &&
      !effectivePositions.includes('SP')
    ) {
      return 'RP';
    }
    if (
      effectivePositions.includes('SP') &&
      !effectivePositions.includes('RP')
    ) {
      return 'SP';
    }

    const saves = avgStats.saves ?? 0;
    const innings = avgStats.innings ?? 0;
    return saves >= 8 && innings <= 110 ? 'RP' : 'SP';
  }

  private computeMultipliers(
    player: Player,
    avgStats: Record<string, number>,
  ): ValuationMultipliers {
    let depthChart: number;
    const effectivePositions = this.getEffectivePositions(player, avgStats);

    if (player.playerType === 'pitcher') {
      if (
        effectivePositions.includes('RP') &&
        !effectivePositions.includes('SP')
      ) {
        depthChart = 1.0;
      } else if (
        player.depthChartOrder === 1 ||
        player.depthChartStatus === 'starter'
      ) {
        depthChart = 1.1;
      } else if (
        player.depthChartOrder === 2 ||
        player.depthChartStatus === 'backup'
      ) {
        depthChart = 1.0;
      } else {
        depthChart = 0.95;
      }
    } else {
      if (
        player.depthChartOrder === 1 ||
        player.depthChartStatus === 'starter'
      ) {
        depthChart = 1.03;
      } else if (
        player.depthChartOrder === 2 ||
        player.depthChartStatus === 'backup'
      ) {
        depthChart = 1.0;
      } else {
        depthChart = 0.98;
      }
    }

    let age = 1.0;
    if (player.age !== undefined) {
      if (player.playerType === 'hitter') {
        if (player.age <= 25) age = 1.03;
        else if (player.age >= 35) age = 0.98;
      } else if (player.age <= 25) {
        age = 1.1;
      } else if (player.age >= 35) {
        age = 0.95;
      }
    }

    let injury = 1.0;
    if (player.injuryStatus && player.injuryStatus !== 'active') {
      if (player.injuryStatus.startsWith('il-60')) {
        injury = 0.7;
      } else if (player.injuryStatus.startsWith('il-')) {
        injury = 0.8;
      } else {
        injury = 0.9;
      }
    }

    return { depthChart, age, injury, scarcity: 1.0 };
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
      return {
        draftable: false,
        reason: 'No open roster slot for this position',
      };
    }

    return { draftable: true };
  }

  private teamHasOpenSlot(
    player: Player,
    league: League,
    teamId: string,
  ): boolean {
    const slots = league.rosterSlots as Record<string, number>;
    const teamDrafted = (league.taken_players ?? []).filter(
      ([, tid]) => tid === teamId,
    );

    const occupied: Record<string, number> = {};
    for (const [, , posSlot] of teamDrafted) {
      const root = parseSlotRoot(posSlot);
      occupied[root] = (occupied[root] ?? 0) + 1;
    }

    for (const pos of player.positions) {
      if ((occupied[pos] ?? 0) < (slots[pos] ?? 0)) return true;

      if (
        (pos === '1B' || pos === '3B') &&
        (occupied['CI'] ?? 0) < (slots['CI'] ?? 0)
      ) {
        return true;
      }

      if (
        (pos === '2B' || pos === 'SS') &&
        (occupied['MI'] ?? 0) < (slots['MI'] ?? 0)
      ) {
        return true;
      }
    }

    if (
      player.playerType === 'hitter' &&
      (occupied['UTIL'] ?? 0) < (slots['UTIL'] ?? 0)
    ) {
      return true;
    }

    if (
      player.playerType === 'pitcher' &&
      (occupied['P'] ?? 0) < (slots['P'] ?? 0)
    ) {
      return true;
    }

    if ((occupied['BENCH'] ?? 0) < (slots['BENCH'] ?? 0)) return true;

    return false;
  }
}

export const valuationsService = new ValuationsService();
