import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { valuationsService } from './valuations.service.js';
import { PlayerModel } from '../players/players.model.js';
import { LeagueModel } from '../leagues/leagues.model.js';
import type { PlayerInput } from '../players/players.types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function hitter(overrides: Partial<PlayerInput> = {}): PlayerInput {
  return {
    externalId: `val-h-${Math.random()}`,
    name: 'Test Hitter',
    team: 'NYY',
    positions: ['OF'],
    league: 'AL',
    playerType: 'hitter',
    injuryStatus: 'active',
    active: true,
    batSide: 'R',
    age: 28,
    depthChartStatus: 'starter',
    depthChartOrder: 1,
    stats: [
      {
        season: '2024',
        type: 'hitter',
        data: { ba: 0.28, hr: 25, rbi: 80, walk: 60, sb: 10 },
      },
    ],
    ...overrides,
  } as PlayerInput;
}

function pitcher(overrides: Partial<PlayerInput> = {}): PlayerInput {
  return {
    externalId: `val-p-${Math.random()}`,
    name: 'Test Pitcher',
    team: 'NYY',
    positions: ['SP'],
    league: 'AL',
    playerType: 'pitcher',
    injuryStatus: 'active',
    active: true,
    pitchHand: 'R',
    age: 28,
    depthChartStatus: 'starter',
    depthChartOrder: 1,
    stats: [
      {
        season: '2024',
        type: 'pitcher',
        data: { era: 3.2, wins: 12, saves: 0, strikeouts: 180, innings: 170 },
      },
    ],
    ...overrides,
  } as PlayerInput;
}

const baseLeague = {
  externalId: 'val-test-league',
  name: 'Valuation Test League',
  format: 'roto' as const,
  draftType: 'auction' as const,
  battingCategories: ['HR', 'RBI', 'AVG', 'SB', 'BB'] as const,
  pitchingCategories: ['ERA', 'W', 'SV', 'K', 'IP'] as const,
  rosterSlots: {
    C: 1,
    '1B': 1,
    '2B': 1,
    '3B': 1,
    SS: 1,
    OF: 3,
    DH: 0,
    SP: 5,
    RP: 2,
    UTIL: 1,
    BENCH: 2,
  },
  totalBudget: 260,
  teams: [
    ['team-1', 'Team One', 260],
    ['team-2', 'Team Two', 260],
  ] as [string, string, number][],
  taken_players: [] as [string, string, string, number][],
  isDefault: false,
};

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(async () => {
  await Promise.all([PlayerModel.deleteMany({}), LeagueModel.deleteMany({})]);
});

afterEach(async () => {
  await Promise.all([PlayerModel.deleteMany({}), LeagueModel.deleteMany({})]);
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ValuationsService.calculateValuations', () => {
  it('throws 404 when league does not exist', async () => {
    await expect(
      valuationsService.calculateValuations('507f1f77bcf86cd799439011', {
        page: 1,
        limit: 50,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('returns empty valuations list when no active players exist', async () => {
    const [league] = await LeagueModel.insertMany([baseLeague]);
    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50 },
    );

    expect(result.leagueId).toBe(league._id.toString());
    expect(result.valuations).toHaveLength(0);
    expect(result.pagination.total).toBe(0);
  });

  it('resolves drafted player names in stateless league payloads', async () => {
    await PlayerModel.insertMany([
      hitter({ externalId: 'h-judge', name: 'Aaron Judge', positions: ['OF'] }),
      hitter({
        externalId: 'h-catcher',
        name: 'Test Catcher',
        positions: ['C'],
      }),
      hitter({
        externalId: 'h-other-of',
        name: 'Other Outfielder',
        positions: ['OF'],
      }),
      hitter({
        externalId: 'h-third-of',
        name: 'Third Outfielder',
        positions: ['OF'],
      }),
    ]);

    const aaronJudgeId = (await PlayerModel.findOne({ name: 'Aaron Judge' })
      .select('_id')
      .lean())!._id.toString();

    const draftedByName = await valuationsService.calculateValuationsForLeague(
      {
        ...baseLeague,
        name: 'Payload League',
        rosterSlots: {
          C: 1,
          '1B': 0,
          '2B': 0,
          '3B': 0,
          SS: 0,
          OF: 1,
          DH: 0,
          SP: 0,
          RP: 0,
          UTIL: 0,
          BENCH: 0,
        },
        taken_players: [['Aaron Judge', 'team-1', 'OF-0', 10]],
      },
      { page: 1, limit: 50 },
    );

    const draftedById = await valuationsService.calculateValuationsForLeague(
      {
        ...baseLeague,
        name: 'Payload League',
        rosterSlots: {
          C: 1,
          '1B': 0,
          '2B': 0,
          '3B': 0,
          SS: 0,
          OF: 1,
          DH: 0,
          SP: 0,
          RP: 0,
          UTIL: 0,
          BENCH: 0,
        },
        taken_players: [[aaronJudgeId, 'team-1', 'OF-0', 10]],
      },
      { page: 1, limit: 50 },
    );

    const draftedJudge = draftedByName.valuations.find(
      (valuation) => valuation.name === 'Aaron Judge',
    )!;
    const draftedJudgeById = draftedById.valuations.find(
      (valuation) => valuation.name === 'Aaron Judge',
    )!;
    const draftedOtherOutfielder = draftedByName.valuations.find(
      (valuation) => valuation.name === 'Other Outfielder',
    )!;
    const draftedOtherOutfielderById = draftedById.valuations.find(
      (valuation) => valuation.name === 'Other Outfielder',
    )!;

    expect(draftedJudge.draftable).toBe(false);
    expect(draftedJudge.draftableReason).toBe(
      'Player has already been drafted',
    );
    expect(draftedJudgeById.draftable).toBe(false);
    expect(draftedOtherOutfielder.multipliers.scarcity).toBe(
      draftedOtherOutfielderById.multipliers.scarcity,
    );
    expect(draftedOtherOutfielder.dollarValue).toBe(
      draftedOtherOutfielderById.dollarValue,
    );
  });

  it('rejects ambiguous drafted player names in stateless league payloads', async () => {
    await PlayerModel.insertMany([
      hitter({ externalId: 'h-ramirez-1', name: 'Jose Ramirez' }),
      hitter({ externalId: 'h-ramirez-2', name: 'José Ramírez' }),
    ]);

    await expect(
      valuationsService.calculateValuationsForLeague(
        {
          ...baseLeague,
          name: 'Payload League',
          taken_players: [['Jose Ramirez', 'team-1', 'OF-0', 10]],
        },
        { page: 1, limit: 50 },
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('Ambiguous player references'),
    });
  });

  it('returns all active players sorted by dollarValue descending', async () => {
    const [league] = await LeagueModel.insertMany([baseLeague]);
    await PlayerModel.insertMany([
      hitter({ externalId: 'h1', name: 'Player A' }),
      hitter({ externalId: 'h2', name: 'Player B' }),
      hitter({ externalId: 'h3', name: 'Player C' }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50 },
    );

    expect(result.valuations.length).toBe(3);
    for (let i = 0; i < result.valuations.length - 1; i++) {
      expect(result.valuations[i].dollarValue).toBeGreaterThanOrEqual(
        result.valuations[i + 1].dollarValue,
      );
    }
  });

  it('excludes inactive players', async () => {
    const [league] = await LeagueModel.insertMany([baseLeague]);
    await PlayerModel.insertMany([
      hitter({ externalId: 'h-active', name: 'Active', active: true }),
      hitter({ externalId: 'h-inactive', name: 'Inactive', active: false }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50 },
    );

    expect(result.valuations).toHaveLength(1);
    expect(result.valuations[0].name).toBe('Active');
  });

  it('gives higher dollarValue to elite hitter vs below-average hitter', async () => {
    const [league] = await LeagueModel.insertMany([baseLeague]);
    await PlayerModel.insertMany([
      hitter({
        externalId: 'h-elite',
        name: 'Elite',
        stats: [
          {
            season: '2024',
            type: 'hitter',
            data: { ba: 0.32, hr: 50, rbi: 130, walk: 110, sb: 30 },
          },
        ],
      }),
      hitter({
        externalId: 'h-weak',
        name: 'Weak',
        stats: [
          {
            season: '2024',
            type: 'hitter',
            data: { ba: 0.22, hr: 5, rbi: 30, walk: 20, sb: 2 },
          },
        ],
      }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50 },
    );

    const elite = result.valuations.find((v) => v.name === 'Elite')!;
    const weak = result.valuations.find((v) => v.name === 'Weak')!;
    expect(elite.dollarValue).toBeGreaterThan(weak.dollarValue);
    expect(elite.baseValue).toBeGreaterThan(weak.baseValue);
  });

  it('sets baseValue to 1 when only one player exists (std=0, no z-score)', async () => {
    const [league] = await LeagueModel.insertMany([baseLeague]);
    await PlayerModel.insertMany([
      // Single player in pool → population std=0 → z-scores undefined → rawZSum=0 → baseValue=1
      hitter({ externalId: 'h-nostats', name: 'No Stats', stats: [] }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50 },
    );

    expect(result.valuations[0].baseValue).toBe(1);
  });

  it('averages stats across up to 3 seasons', async () => {
    const [league] = await LeagueModel.insertMany([baseLeague]);
    await PlayerModel.insertMany([
      hitter({
        externalId: 'h-multi',
        name: 'Multi Season',
        stats: [
          {
            season: '2023',
            type: 'hitter',
            data: { ba: 0.26, hr: 20, rbi: 70, walk: 50, sb: 8 },
          },
          {
            season: '2024',
            type: 'hitter',
            data: { ba: 0.28, hr: 30, rbi: 90, walk: 70, sb: 12 },
          },
          {
            season: '2025',
            type: 'hitter',
            data: { ba: 0.3, hr: 40, rbi: 110, walk: 90, sb: 16 },
          },
        ],
      }),
      hitter({
        externalId: 'h-single',
        name: 'Single Season',
        stats: [
          {
            season: '2025',
            type: 'hitter',
            data: { ba: 0.28, hr: 30, rbi: 90, walk: 70, sb: 12 },
          },
        ],
      }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50 },
    );

    const multi = result.valuations.find((v) => v.name === 'Multi Season')!;
    // Weighted: 0.1×20 + 0.3×30 + 0.6×40 = 35 hr; 0.1×0.260 + 0.3×0.280 + 0.6×0.300 = 0.290 ba
    expect(multi.averagedStats.hr).toBeCloseTo(35, 1);
    expect(multi.averagedStats.ba).toBeCloseTo(0.29, 2);
  });

  // ── Age multiplier ─────────────────────────────────────────────────────────

  it('applies 1.5x age multiplier to players aged 25 and under', async () => {
    const [league] = await LeagueModel.insertMany([baseLeague]);
    await PlayerModel.insertMany([
      hitter({ externalId: 'h-young', name: 'Young', age: 22 }),
      hitter({ externalId: 'h-prime', name: 'Prime', age: 29 }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50 },
    );

    const young = result.valuations.find((v) => v.name === 'Young')!;
    const prime = result.valuations.find((v) => v.name === 'Prime')!;
    expect(young.multipliers.age).toBe(1.5);
    expect(prime.multipliers.age).toBe(1.0);
  });

  it('applies 0.85x age multiplier to players aged 35 and over', async () => {
    const [league] = await LeagueModel.insertMany([baseLeague]);
    await PlayerModel.insertMany([
      hitter({ externalId: 'h-old', name: 'Old', age: 37 }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50 },
    );

    expect(result.valuations[0].multipliers.age).toBe(0.85);
  });

  it('applies 1.0x age multiplier when age is unknown', async () => {
    const [league] = await LeagueModel.insertMany([baseLeague]);
    const { age: _age, ...noAge } = hitter({
      externalId: 'h-noage',
      name: 'No Age',
    });
    await PlayerModel.insertMany([noAge]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50 },
    );

    expect(result.valuations[0].multipliers.age).toBe(1.0);
  });

  // ── Injury multiplier ──────────────────────────────────────────────────────

  it('applies 0.2x injury multiplier to non-active players', async () => {
    const [league] = await LeagueModel.insertMany([baseLeague]);
    await PlayerModel.insertMany([
      hitter({ externalId: 'h-il', name: 'IL Player', injuryStatus: 'il-15' }),
      hitter({
        externalId: 'h-dtd',
        name: 'DTD Player',
        injuryStatus: 'day-to-day',
      }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50 },
    );

    for (const v of result.valuations) {
      expect(v.multipliers.injury).toBe(0.2);
    }
  });

  it('injured player has lower dollarValue than identical healthy player', async () => {
    const [league] = await LeagueModel.insertMany([baseLeague]);
    const stats = [
      {
        season: '2024',
        type: 'hitter' as const,
        data: { ba: 0.3, hr: 35, rbi: 100, walk: 75, sb: 15 },
      },
    ];
    await PlayerModel.insertMany([
      hitter({
        externalId: 'h-healthy',
        name: 'Healthy',
        injuryStatus: 'active',
        stats,
      }),
      hitter({
        externalId: 'h-hurt',
        name: 'Hurt',
        injuryStatus: 'il-60',
        stats,
      }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50 },
    );

    const healthy = result.valuations.find((v) => v.name === 'Healthy')!;
    const hurt = result.valuations.find((v) => v.name === 'Hurt')!;
    expect(healthy.dollarValue).toBeGreaterThan(hurt.dollarValue);
  });

  // ── Depth chart multiplier ─────────────────────────────────────────────────

  it('applies correct depth chart multipliers', async () => {
    const [league] = await LeagueModel.insertMany([baseLeague]);
    await PlayerModel.insertMany([
      hitter({
        externalId: 'h-start',
        name: 'Starter',
        depthChartStatus: 'starter',
        depthChartOrder: 1,
      }),
      hitter({
        externalId: 'h-back',
        name: 'Backup',
        depthChartStatus: 'backup',
        depthChartOrder: 2,
      }),
      hitter({
        externalId: 'h-res',
        name: 'Reserve',
        depthChartStatus: 'reserve',
        depthChartOrder: 4,
      }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50 },
    );

    const starter = result.valuations.find((v) => v.name === 'Starter')!;
    const backup = result.valuations.find((v) => v.name === 'Backup')!;
    const reserve = result.valuations.find((v) => v.name === 'Reserve')!;
    expect(starter.multipliers.depthChart).toBe(1.5);
    expect(backup.multipliers.depthChart).toBe(1.0);
    expect(reserve.multipliers.depthChart).toBe(0.85);
  });

  it('applies 0.85x depth chart multiplier when status is unknown', async () => {
    const [league] = await LeagueModel.insertMany([baseLeague]);
    const {
      depthChartStatus: _s,
      depthChartOrder: _o,
      ...noDepth
    } = hitter({
      externalId: 'h-nodepth',
      name: 'No Depth',
    });
    await PlayerModel.insertMany([noDepth]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50 },
    );

    expect(result.valuations[0].multipliers.depthChart).toBe(0.85);
  });

  // ── Scarcity ───────────────────────────────────────────────────────────────

  it('includes scarcity multiplier in every valuation', async () => {
    const [league] = await LeagueModel.insertMany([baseLeague]);
    await PlayerModel.insertMany([hitter()]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50 },
    );

    expect(result.valuations[0].multipliers.scarcity).toBeDefined();
    expect(typeof result.valuations[0].multipliers.scarcity).toBe('number');
  });

  it('catcher scarcity is at least as high as OF (scarcer position)', async () => {
    const [league] = await LeagueModel.insertMany([
      {
        ...baseLeague,
        externalId: 'scarcity-test',
        rosterSlots: {
          C: 2,
          '1B': 1,
          '2B': 1,
          '3B': 1,
          SS: 1,
          OF: 5,
          DH: 0,
          SP: 5,
          RP: 2,
          UTIL: 0,
          BENCH: 0,
        },
      },
    ]);
    await PlayerModel.insertMany([
      hitter({ externalId: 'c1', positions: ['C'] }),
      hitter({ externalId: 'c2', positions: ['C'] }),
      hitter({ externalId: 'of1', positions: ['OF'] }),
      hitter({ externalId: 'of2', positions: ['OF'] }),
      hitter({ externalId: 'of3', positions: ['OF'] }),
      hitter({ externalId: 'of4', positions: ['OF'] }),
      hitter({ externalId: 'of5', positions: ['OF'] }),
      hitter({ externalId: 'of6', positions: ['OF'] }),
      hitter({ externalId: 'of7', positions: ['OF'] }),
      hitter({ externalId: 'of8', positions: ['OF'] }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50 },
    );

    const catcher = result.valuations.find((v) => v.positions.includes('C'))!;
    const outfielder = result.valuations.find((v) =>
      v.positions.includes('OF'),
    )!;
    expect(catcher.multipliers.scarcity).toBeGreaterThanOrEqual(
      outfielder.multipliers.scarcity,
    );
  });

  it('removes drafted players from scarcity supply', async () => {
    const [leagueWithoutDrafts] = await LeagueModel.insertMany([
      {
        ...baseLeague,
        externalId: 'scarcity-undrafted',
        rosterSlots: {
          C: 1,
          '1B': 0,
          '2B': 0,
          '3B': 0,
          SS: 0,
          OF: 2,
          DH: 0,
          SP: 0,
          RP: 0,
          UTIL: 0,
          BENCH: 0,
        },
      },
    ]);

    const insertedPlayers = await PlayerModel.insertMany([
      hitter({
        externalId: 'scarcity-c-1',
        name: 'Catcher A',
        positions: ['C'],
      }),
      hitter({
        externalId: 'scarcity-c-2',
        name: 'Catcher B',
        positions: ['C'],
      }),
      hitter({
        externalId: 'scarcity-of-1',
        name: 'Outfielder A',
        positions: ['OF'],
      }),
      hitter({
        externalId: 'scarcity-of-2',
        name: 'Outfielder B',
        positions: ['OF'],
      }),
      hitter({
        externalId: 'scarcity-of-3',
        name: 'Outfielder C',
        positions: ['OF'],
      }),
      hitter({
        externalId: 'scarcity-of-4',
        name: 'Outfielder D',
        positions: ['OF'],
      }),
    ]);

    const draftedCatcherId = insertedPlayers
      .find((player) => player.name === 'Catcher A')!
      ._id.toString();

    const baseline = await valuationsService.calculateValuations(
      leagueWithoutDrafts._id.toString(),
      { page: 1, limit: 50 },
    );

    const [leagueWithDraftedCatcher] = await LeagueModel.insertMany([
      {
        ...baseLeague,
        externalId: 'scarcity-drafted',
        rosterSlots: {
          C: 1,
          '1B': 0,
          '2B': 0,
          '3B': 0,
          SS: 0,
          OF: 2,
          DH: 0,
          SP: 0,
          RP: 0,
          UTIL: 0,
          BENCH: 0,
        },
        taken_players: [[draftedCatcherId, 'team-1', 'C-0', 1]],
      },
    ]);

    const withDraftedCatcher = await valuationsService.calculateValuations(
      leagueWithDraftedCatcher._id.toString(),
      { page: 1, limit: 50 },
    );

    const baselineCatcher = baseline.valuations.find(
      (v) => v.name === 'Catcher B',
    )!;
    const draftedPoolCatcher = withDraftedCatcher.valuations.find(
      (v) => v.name === 'Catcher B',
    )!;

    expect(draftedPoolCatcher.multipliers.scarcity).toBeGreaterThan(
      baselineCatcher.multipliers.scarcity,
    );
    expect(draftedPoolCatcher.dollarValue).toBeGreaterThan(
      baselineCatcher.dollarValue,
    );
  });

  // ── Draftability ───────────────────────────────────────────────────────────

  it('marks taken players as not draftable', async () => {
    const inserted = await PlayerModel.insertMany([
      hitter({ externalId: 'h-taken', name: 'Taken Player' }),
      hitter({ externalId: 'h-free', name: 'Free Player' }),
    ]);

    const takenId = inserted[0]._id.toString();

    const [league] = await LeagueModel.insertMany([
      {
        ...baseLeague,
        externalId: 'taken-test',
        taken_players: [[takenId, 'team-1', 'OF', 15]],
      },
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50 },
    );

    const taken = result.valuations.find((v) => v.name === 'Taken Player')!;
    const free = result.valuations.find((v) => v.name === 'Free Player')!;
    expect(taken.draftable).toBe(false);
    expect(taken.draftableReason).toBe('Player has already been drafted');
    expect(free.draftable).toBe(true);
  });

  it('marks player as not draftable when team has no open slot', async () => {
    const [league] = await LeagueModel.insertMany([
      {
        ...baseLeague,
        externalId: 'no-slot-test',
        rosterSlots: {
          C: 1,
          '1B': 1,
          '2B': 1,
          '3B': 1,
          SS: 1,
          OF: 1,
          DH: 0,
          SP: 5,
          RP: 2,
          UTIL: 0,
          BENCH: 0,
        },
        // team-1 has already filled its one OF slot
        taken_players: [['other-player-id', 'team-1', 'OF', 10]],
      },
    ]);
    await PlayerModel.insertMany([
      hitter({ externalId: 'h-of', name: 'OF Player', positions: ['OF'] }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50, teamId: 'team-1' },
    );

    expect(result.valuations[0].draftable).toBe(false);
    expect(result.valuations[0].draftableReason).toContain(
      'No open roster slot',
    );
  });

  it('marks player as draftable when team has an open slot', async () => {
    const [league] = await LeagueModel.insertMany([
      {
        ...baseLeague,
        externalId: 'has-slot-test',
        rosterSlots: {
          C: 1,
          '1B': 1,
          '2B': 1,
          '3B': 1,
          SS: 1,
          OF: 2,
          DH: 0,
          SP: 5,
          RP: 2,
          UTIL: 0,
          BENCH: 0,
        },
        taken_players: [['some-id', 'team-1', 'OF', 10]], // only 1 OF taken, 2 slots
      },
    ]);
    await PlayerModel.insertMany([
      hitter({ externalId: 'h-of', name: 'OF Player', positions: ['OF'] }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50, teamId: 'team-1' },
    );

    expect(result.valuations[0].draftable).toBe(true);
  });

  it('all players are draftable when no teamId is provided', async () => {
    const [league] = await LeagueModel.insertMany([baseLeague]);
    await PlayerModel.insertMany([
      hitter({ externalId: 'h1' }),
      hitter({ externalId: 'h2' }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50 },
    );

    expect(result.valuations.every((v) => v.draftable)).toBe(true);
  });

  // ── Filtering ──────────────────────────────────────────────────────────────

  it('filters results by playerType', async () => {
    const [league] = await LeagueModel.insertMany([baseLeague]);
    await PlayerModel.insertMany([
      hitter({ externalId: 'h1', name: 'Hitter 1' }),
      hitter({ externalId: 'h2', name: 'Hitter 2' }),
      pitcher({ externalId: 'p1', name: 'Pitcher 1' }),
    ]);

    const hitterResult = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50, playerType: 'hitter' },
    );
    const pitcherResult = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50, playerType: 'pitcher' },
    );

    expect(
      hitterResult.valuations.every((v) => v.playerType === 'hitter'),
    ).toBe(true);
    expect(hitterResult.pagination.total).toBe(2);
    expect(
      pitcherResult.valuations.every((v) => v.playerType === 'pitcher'),
    ).toBe(true);
    expect(pitcherResult.pagination.total).toBe(1);
  });

  // ── Pagination ─────────────────────────────────────────────────────────────

  it('paginates results correctly', async () => {
    const [league] = await LeagueModel.insertMany([baseLeague]);
    await PlayerModel.insertMany(
      Array.from({ length: 6 }, (_, i) =>
        hitter({ externalId: `h-page-${i}`, name: `Player ${i}` }),
      ),
    );

    const page1 = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 4 },
    );
    const page2 = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 2, limit: 4 },
    );

    expect(page1.valuations).toHaveLength(4);
    expect(page2.valuations).toHaveLength(2);
    expect(page1.pagination).toEqual({ page: 1, limit: 4, total: 6 });
    expect(page2.pagination).toEqual({ page: 2, limit: 4, total: 6 });

    // No overlap between pages
    const page1Ids = new Set(page1.valuations.map((v) => v.playerId));
    for (const v of page2.valuations) {
      expect(page1Ids.has(v.playerId)).toBe(false);
    }
  });

  // ── Response shape ─────────────────────────────────────────────────────────

  it('returns the correct response shape', async () => {
    const [league] = await LeagueModel.insertMany([baseLeague]);
    await PlayerModel.insertMany([hitter()]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50 },
    );

    expect(result).toMatchObject({
      leagueId: expect.any(String),
      leagueName: 'Valuation Test League',
      pagination: { page: 1, limit: 50, total: 1 },
    });

    const v = result.valuations[0];
    expect(v).toMatchObject({
      playerId: expect.any(String),
      name: expect.any(String),
      team: expect.any(String),
      positions: expect.any(Array),
      playerType: expect.stringMatching(/^(hitter|pitcher)$/),
      injuryStatus: expect.any(String),
      baseValue: expect.any(Number),
      dollarValue: expect.any(Number),
      draftable: expect.any(Boolean),
      multipliers: {
        depthChart: expect.any(Number),
        age: expect.any(Number),
        injury: expect.any(Number),
        scarcity: expect.any(Number),
      },
    });
  });

  // ── Pitchers ───────────────────────────────────────────────────────────────

  it('uses pitching categories for pitcher valuations', async () => {
    const [league] = await LeagueModel.insertMany([baseLeague]);
    await PlayerModel.insertMany([
      pitcher({
        externalId: 'p-ace',
        name: 'Ace',
        stats: [
          {
            season: '2024',
            type: 'pitcher',
            data: {
              era: 2.1,
              wins: 18,
              saves: 0,
              strikeouts: 250,
              innings: 200,
            },
          },
        ],
      }),
      pitcher({
        externalId: 'p-avg',
        name: 'Average Arm',
        stats: [
          {
            season: '2024',
            type: 'pitcher',
            data: {
              era: 4.8,
              wins: 8,
              saves: 0,
              strikeouts: 110,
              innings: 130,
            },
          },
        ],
      }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50, playerType: 'pitcher' },
    );

    const ace = result.valuations.find((v) => v.name === 'Ace')!;
    const avg = result.valuations.find((v) => v.name === 'Average Arm')!;
    expect(ace.dollarValue).toBeGreaterThan(avg.dollarValue);
  });

  it('treats ERA as lower-is-better for pitchers', async () => {
    const [league] = await LeagueModel.insertMany([baseLeague]);
    await PlayerModel.insertMany([
      pitcher({
        externalId: 'p-good-era',
        name: 'Good ERA',
        stats: [
          {
            season: '2024',
            type: 'pitcher',
            data: {
              era: 2.0,
              wins: 10,
              saves: 0,
              strikeouts: 150,
              innings: 150,
            },
          },
        ],
      }),
      pitcher({
        externalId: 'p-bad-era',
        name: 'Bad ERA',
        stats: [
          {
            season: '2024',
            type: 'pitcher',
            data: {
              era: 6.0,
              wins: 10,
              saves: 0,
              strikeouts: 150,
              innings: 150,
            },
          },
        ],
      }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50, playerType: 'pitcher' },
    );

    const good = result.valuations.find((v) => v.name === 'Good ERA')!;
    const bad = result.valuations.find((v) => v.name === 'Bad ERA')!;
    expect(good.dollarValue).toBeGreaterThan(bad.dollarValue);
  });
});
