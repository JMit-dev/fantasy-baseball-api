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
    CI: 0,
    MI: 0,
    OF: 3,
    DH: 0,
    SP: 5,
    RP: 2,
    P: 0,
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

  it('applies 1.03x age multiplier to hitters aged 25 and under', async () => {
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
    expect(young.multipliers.age).toBe(1.03);
    expect(prime.multipliers.age).toBe(1.0);
  });

  it('applies 0.98x age multiplier to hitters aged 35 and over', async () => {
    const [league] = await LeagueModel.insertMany([baseLeague]);
    await PlayerModel.insertMany([
      hitter({ externalId: 'h-old', name: 'Old', age: 37 }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50 },
    );

    expect(result.valuations[0].multipliers.age).toBe(0.98);
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

  it('applies softer injury discounts by injury status', async () => {
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

    const ilPlayer = result.valuations.find((v) => v.name === 'IL Player')!;
    const dtdPlayer = result.valuations.find((v) => v.name === 'DTD Player')!;
    expect(ilPlayer.multipliers.injury).toBe(0.8);
    expect(dtdPlayer.multipliers.injury).toBe(0.9);
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
    expect(starter.multipliers.depthChart).toBe(1.03);
    expect(backup.multipliers.depthChart).toBe(1.0);
    expect(reserve.multipliers.depthChart).toBe(0.98);
  });

  it('applies 0.98x depth chart multiplier when status is unknown', async () => {
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

    expect(result.valuations[0].multipliers.depthChart).toBe(0.98);
  });

  it('does not apply depth chart adjustments to relief pitchers', async () => {
    const [league] = await LeagueModel.insertMany([baseLeague]);
    await PlayerModel.insertMany([
      pitcher({
        externalId: 'rp-setup',
        name: 'Setup Reliever',
        positions: ['RP'],
        depthChartStatus: 'reserve',
        depthChartOrder: 6,
      }),
      pitcher({
        externalId: 'rp-closer',
        name: 'Closer Reliever',
        positions: ['RP'],
        depthChartStatus: 'starter',
        depthChartOrder: 1,
      }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50 },
    );

    const setup = result.valuations.find((v) => v.name === 'Setup Reliever')!;
    const closer = result.valuations.find((v) => v.name === 'Closer Reliever')!;
    expect(setup.multipliers.depthChart).toBe(1.0);
    expect(closer.multipliers.depthChart).toBe(1.0);
  });

  it('infers reliever role from saves-heavy pitcher stat lines', async () => {
    const [league] = await LeagueModel.insertMany([
      {
        ...baseLeague,
        externalId: 'inferred-rp-test',
        rosterSlots: {
          ...baseLeague.rosterSlots,
          SP: 0,
          RP: 1,
          P: 0,
        },
      },
    ]);
    await PlayerModel.insertMany([
      pitcher({
        externalId: 'rp-inferred',
        name: 'Inferred Reliever',
        positions: ['SP'],
        depthChartStatus: 'starter',
        depthChartOrder: 1,
        stats: [
          {
            season: '2024',
            type: 'pitcher',
            data: { era: 2.2, wins: 4, saves: 32, strikeouts: 86, innings: 66 },
          },
        ],
      }),
      pitcher({
        externalId: 'sp-control',
        name: 'Starter Control',
        positions: ['SP'],
        stats: [
          {
            season: '2024',
            type: 'pitcher',
            data: {
              era: 3.6,
              wins: 11,
              saves: 0,
              strikeouts: 170,
              innings: 172,
            },
          },
        ],
      }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50, playerType: 'pitcher' },
    );

    const reliever = result.valuations.find(
      (v) => v.name === 'Inferred Reliever',
    )!;
    expect(reliever.multipliers.depthChart).toBe(1.0);
  });

  it('still applies depth chart adjustments to starting pitchers', async () => {
    const [league] = await LeagueModel.insertMany([baseLeague]);
    await PlayerModel.insertMany([
      pitcher({
        externalId: 'sp-depth-start',
        name: 'Starter Pitcher',
        positions: ['SP'],
        depthChartStatus: 'starter',
        depthChartOrder: 1,
      }),
      pitcher({
        externalId: 'sp-depth-reserve',
        name: 'Reserve Pitcher',
        positions: ['SP'],
        depthChartStatus: 'reserve',
        depthChartOrder: 5,
      }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50, playerType: 'pitcher' },
    );

    const starter = result.valuations.find(
      (v) => v.name === 'Starter Pitcher',
    )!;
    const reserve = result.valuations.find(
      (v) => v.name === 'Reserve Pitcher',
    )!;
    expect(starter.multipliers.depthChart).toBe(1.1);
    expect(reserve.multipliers.depthChart).toBe(0.95);
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

  it('keeps scarcity neutral when all position slots are open', async () => {
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
    expect(catcher.multipliers.scarcity).toBe(1);
    expect(outfielder.multipliers.scarcity).toBe(1);
  });

  it('increases scarcity as position slots fill up', async () => {
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
        externalId: 'scarcity-c-2',
        name: 'Catcher B',
        positions: ['C'],
      }),
      hitter({
        externalId: 'scarcity-of-1',
        positions: ['OF'],
      }),
      hitter({
        externalId: 'scarcity-of-2',
        positions: ['OF'],
      }),
    ]);

    const draftedCatcherId = insertedPlayers
      .find((player) => player.name === 'Catcher B')!
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
        taken_players: [[draftedCatcherId, 'team-1', 'C-0', 1, '']],
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

    expect(baselineCatcher.multipliers.scarcity).toBe(1);
    expect(draftedPoolCatcher.multipliers.scarcity).toBeGreaterThan(1);
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
    expect(ace.baseValue).toBeGreaterThan(avg.baseValue);
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

  it('gives elite starters materially higher base values than mid-tier starters', async () => {
    const [league] = await LeagueModel.insertMany([
      {
        ...baseLeague,
        externalId: 'starter-replacement-test',
        rosterSlots: {
          ...baseLeague.rosterSlots,
          SP: 2,
          RP: 0,
        },
      },
    ]);
    await PlayerModel.insertMany([
      pitcher({
        externalId: 'sp-elite',
        name: 'Elite Starter',
        positions: ['SP'],
        stats: [
          {
            season: '2024',
            type: 'pitcher',
            data: {
              era: 2.1,
              wins: 18,
              saves: 0,
              strikeouts: 250,
              innings: 205,
            },
          },
        ],
      }),
      pitcher({
        externalId: 'sp-strong',
        name: 'Strong Starter',
        positions: ['SP'],
        stats: [
          {
            season: '2024',
            type: 'pitcher',
            data: {
              era: 3.0,
              wins: 14,
              saves: 0,
              strikeouts: 200,
              innings: 185,
            },
          },
        ],
      }),
      pitcher({
        externalId: 'sp-mid',
        name: 'Mid Starter',
        positions: ['SP'],
        stats: [
          {
            season: '2024',
            type: 'pitcher',
            data: {
              era: 4.0,
              wins: 10,
              saves: 0,
              strikeouts: 150,
              innings: 155,
            },
          },
        ],
      }),
      pitcher({
        externalId: 'sp-weak',
        name: 'Weak Starter',
        positions: ['SP'],
        stats: [
          {
            season: '2024',
            type: 'pitcher',
            data: {
              era: 5.0,
              wins: 7,
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

    const elite = result.valuations.find((v) => v.name === 'Elite Starter')!;
    const mid = result.valuations.find((v) => v.name === 'Mid Starter')!;
    expect(elite.baseValue).toBeGreaterThan(mid.baseValue);
    expect(elite.baseValue).toBeGreaterThan(1);
  });

  it('gives elite relievers materially higher base values than weak relievers', async () => {
    const [league] = await LeagueModel.insertMany([
      {
        ...baseLeague,
        externalId: 'reliever-replacement-test',
        rosterSlots: {
          ...baseLeague.rosterSlots,
          SP: 0,
          RP: 1,
        },
      },
    ]);
    await PlayerModel.insertMany([
      pitcher({
        externalId: 'rp-elite',
        name: 'Elite Reliever',
        positions: ['RP'],
        stats: [
          {
            season: '2024',
            type: 'pitcher',
            data: { era: 1.9, wins: 4, saves: 38, strikeouts: 90, innings: 65 },
          },
        ],
      }),
      pitcher({
        externalId: 'rp-strong',
        name: 'Strong Reliever',
        positions: ['RP'],
        stats: [
          {
            season: '2024',
            type: 'pitcher',
            data: { era: 2.5, wins: 3, saves: 28, strikeouts: 78, innings: 62 },
          },
        ],
      }),
      pitcher({
        externalId: 'rp-weak',
        name: 'Weak Reliever',
        positions: ['RP'],
        stats: [
          {
            season: '2024',
            type: 'pitcher',
            data: { era: 4.8, wins: 1, saves: 5, strikeouts: 48, innings: 52 },
          },
        ],
      }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50, playerType: 'pitcher' },
    );

    const elite = result.valuations.find((v) => v.name === 'Elite Reliever')!;
    const weak = result.valuations.find((v) => v.name === 'Weak Reliever')!;
    expect(elite.baseValue).toBeGreaterThan(weak.baseValue);
    expect(elite.baseValue).toBeGreaterThan(1);
  });

  it('dual-eligible pitchers with strong combined stats get positive base value', async () => {
    const [league] = await LeagueModel.insertMany([
      {
        ...baseLeague,
        externalId: 'dual-role-test',
        rosterSlots: {
          ...baseLeague.rosterSlots,
          SP: 1,
          RP: 1,
        },
      },
    ]);
    await PlayerModel.insertMany([
      pitcher({
        externalId: 'sp-anchor',
        name: 'Starter Anchor',
        positions: ['SP'],
        stats: [
          {
            season: '2024',
            type: 'pitcher',
            data: {
              era: 2.2,
              wins: 16,
              saves: 0,
              strikeouts: 230,
              innings: 198,
            },
          },
        ],
      }),
      pitcher({
        externalId: 'rp-anchor',
        name: 'Reliever Anchor',
        positions: ['RP'],
        stats: [
          {
            season: '2024',
            type: 'pitcher',
            data: { era: 2.0, wins: 4, saves: 35, strikeouts: 88, innings: 66 },
          },
        ],
      }),
      pitcher({
        externalId: 'swingman',
        name: 'Swingman',
        positions: ['SP', 'RP'],
        stats: [
          {
            season: '2024',
            type: 'pitcher',
            data: {
              era: 2.1,
              wins: 14,
              saves: 25,
              strikeouts: 200,
              innings: 160,
            },
          },
        ],
      }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50, playerType: 'pitcher' },
    );

    const swingman = result.valuations.find((v) => v.name === 'Swingman')!;
    expect(swingman.baseValue).toBeGreaterThan(1);
  });

  it('raises starter replacement depth when the league has more SP slots', async () => {
    await PlayerModel.insertMany([
      pitcher({
        externalId: 'sp-a',
        name: 'Starter A',
        positions: ['SP'],
        stats: [
          {
            season: '2024',
            type: 'pitcher',
            data: {
              era: 2.2,
              wins: 16,
              saves: 0,
              strikeouts: 230,
              innings: 198,
            },
          },
        ],
      }),
      pitcher({
        externalId: 'sp-b',
        name: 'Starter B',
        positions: ['SP'],
        stats: [
          {
            season: '2024',
            type: 'pitcher',
            data: {
              era: 2.8,
              wins: 14,
              saves: 0,
              strikeouts: 205,
              innings: 182,
            },
          },
        ],
      }),
      pitcher({
        externalId: 'sp-c',
        name: 'Starter C',
        positions: ['SP'],
        stats: [
          {
            season: '2024',
            type: 'pitcher',
            data: {
              era: 3.5,
              wins: 11,
              saves: 0,
              strikeouts: 170,
              innings: 165,
            },
          },
        ],
      }),
      pitcher({
        externalId: 'sp-d',
        name: 'Starter D',
        positions: ['SP'],
        stats: [
          {
            season: '2024',
            type: 'pitcher',
            data: {
              era: 4.2,
              wins: 9,
              saves: 0,
              strikeouts: 145,
              innings: 150,
            },
          },
        ],
      }),
    ]);

    const [shallowLeague] = await LeagueModel.insertMany([
      {
        ...baseLeague,
        externalId: 'sp-shallow',
        rosterSlots: {
          ...baseLeague.rosterSlots,
          SP: 1,
          RP: 0,
        },
      },
    ]);
    const [deepLeague] = await LeagueModel.insertMany([
      {
        ...baseLeague,
        externalId: 'sp-deep',
        rosterSlots: {
          ...baseLeague.rosterSlots,
          SP: 2,
          RP: 0,
        },
      },
    ]);

    const shallow = await valuationsService.calculateValuations(
      shallowLeague._id.toString(),
      { page: 1, limit: 50, playerType: 'pitcher' },
    );
    const deep = await valuationsService.calculateValuations(
      deepLeague._id.toString(),
      { page: 1, limit: 50, playerType: 'pitcher' },
    );

    const starterAShallow = shallow.valuations.find(
      (v) => v.name === 'Starter A',
    )!;
    const starterADeep = deep.valuations.find((v) => v.name === 'Starter A')!;
    expect(starterADeep.baseValue).toBeGreaterThan(starterAShallow.baseValue);
  });

  it('raises reliever replacement depth when the league has more RP slots', async () => {
    await PlayerModel.insertMany([
      pitcher({
        externalId: 'rp-a',
        name: 'Reliever A',
        positions: ['RP'],
        stats: [
          {
            season: '2024',
            type: 'pitcher',
            data: { era: 1.9, wins: 4, saves: 38, strikeouts: 90, innings: 65 },
          },
        ],
      }),
      pitcher({
        externalId: 'rp-b',
        name: 'Reliever B',
        positions: ['RP'],
        stats: [
          {
            season: '2024',
            type: 'pitcher',
            data: { era: 2.5, wins: 3, saves: 28, strikeouts: 78, innings: 62 },
          },
        ],
      }),
      pitcher({
        externalId: 'rp-c',
        name: 'Reliever C',
        positions: ['RP'],
        stats: [
          {
            season: '2024',
            type: 'pitcher',
            data: { era: 3.1, wins: 2, saves: 15, strikeouts: 64, innings: 58 },
          },
        ],
      }),
      pitcher({
        externalId: 'rp-d',
        name: 'Reliever D',
        positions: ['RP'],
        stats: [
          {
            season: '2024',
            type: 'pitcher',
            data: { era: 4.5, wins: 1, saves: 4, strikeouts: 46, innings: 52 },
          },
        ],
      }),
    ]);

    const [shallowLeague] = await LeagueModel.insertMany([
      {
        ...baseLeague,
        externalId: 'rp-shallow',
        rosterSlots: {
          ...baseLeague.rosterSlots,
          SP: 0,
          RP: 1,
        },
      },
    ]);
    const [deepLeague] = await LeagueModel.insertMany([
      {
        ...baseLeague,
        externalId: 'rp-deep',
        rosterSlots: {
          ...baseLeague.rosterSlots,
          SP: 0,
          RP: 2,
        },
      },
    ]);

    const shallow = await valuationsService.calculateValuations(
      shallowLeague._id.toString(),
      { page: 1, limit: 50, playerType: 'pitcher' },
    );
    const deep = await valuationsService.calculateValuations(
      deepLeague._id.toString(),
      { page: 1, limit: 50, playerType: 'pitcher' },
    );

    const relieverAShallow = shallow.valuations.find(
      (v) => v.name === 'Reliever A',
    )!;
    const relieverADeep = deep.valuations.find((v) => v.name === 'Reliever A')!;
    expect(relieverADeep.baseValue).toBeGreaterThan(relieverAShallow.baseValue);
  });

  it('treats CI as an open roster slot for eligible corner infielders', async () => {
    const [league] = await LeagueModel.insertMany([
      {
        ...baseLeague,
        externalId: 'ci-open-slot',
        rosterSlots: {
          ...baseLeague.rosterSlots,
          '1B': 0,
          '3B': 0,
          CI: 1,
          UTIL: 0,
          BENCH: 0,
        },
      },
    ]);
    await PlayerModel.insertMany([
      hitter({
        externalId: 'ci-eligible',
        name: 'Corner Eligible',
        positions: ['1B'],
      }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50, playerType: 'hitter', teamId: 'team-1' },
    );

    expect(result.valuations[0].draftable).toBe(true);
  });

  it('treats MI as an open roster slot for eligible middle infielders', async () => {
    const [league] = await LeagueModel.insertMany([
      {
        ...baseLeague,
        externalId: 'mi-open-slot',
        rosterSlots: {
          ...baseLeague.rosterSlots,
          '2B': 0,
          SS: 0,
          MI: 1,
          UTIL: 0,
          BENCH: 0,
        },
      },
    ]);
    await PlayerModel.insertMany([
      hitter({
        externalId: 'mi-eligible',
        name: 'Middle Eligible',
        positions: ['SS'],
      }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50, playerType: 'hitter', teamId: 'team-1' },
    );

    expect(result.valuations[0].draftable).toBe(true);
  });

  it('treats P as an open roster slot for pitchers', async () => {
    const [league] = await LeagueModel.insertMany([
      {
        ...baseLeague,
        externalId: 'p-open-slot',
        rosterSlots: {
          ...baseLeague.rosterSlots,
          SP: 0,
          RP: 0,
          P: 1,
          BENCH: 0,
        },
      },
    ]);
    await PlayerModel.insertMany([
      pitcher({
        externalId: 'p-eligible',
        name: 'Pitcher Eligible',
        positions: ['SP'],
      }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50, playerType: 'pitcher', teamId: 'team-1' },
    );

    expect(result.valuations[0].draftable).toBe(true);
  });

  it('uses a deeper bat-only pool for DH hitters than for corner infielders', async () => {
    const [league] = await LeagueModel.insertMany([
      {
        ...baseLeague,
        externalId: 'dh-bat-pool-test',
        rosterSlots: {
          ...baseLeague.rosterSlots,
          DH: 1,
          UTIL: 1,
        },
      },
    ]);
    await PlayerModel.insertMany([
      hitter({
        externalId: 'dh-elite',
        name: 'DH Elite',
        positions: ['DH'],
        stats: [
          {
            season: '2024',
            type: 'hitter',
            data: { ba: 0.3, hr: 42, rbi: 118, walk: 90, sb: 1 },
          },
        ],
      }),
      hitter({
        externalId: 'corner-elite',
        name: 'Corner Elite',
        positions: ['1B'],
        stats: [
          {
            season: '2024',
            type: 'hitter',
            data: { ba: 0.3, hr: 42, rbi: 118, walk: 90, sb: 1 },
          },
        ],
      }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50, playerType: 'hitter' },
    );

    const dh = result.valuations.find((v) => v.name === 'DH Elite')!;
    const corner = result.valuations.find((v) => v.name === 'Corner Elite')!;
    expect(dh.baseValue).toBeLessThan(corner.baseValue);
  });

  it('does not let stolen-base-heavy hitters overwhelm power hitters by speed alone', async () => {
    const [league] = await LeagueModel.insertMany([baseLeague]);
    await PlayerModel.insertMany([
      hitter({
        externalId: 'speed-only',
        name: 'Speed Only',
        positions: ['SS'],
        stats: [
          {
            season: '2024',
            type: 'hitter',
            data: { ba: 0.255, hr: 8, rbi: 48, walk: 30, sb: 55 },
          },
        ],
      }),
      hitter({
        externalId: 'power-star',
        name: 'Power Star',
        positions: ['1B'],
        stats: [
          {
            season: '2024',
            type: 'hitter',
            data: { ba: 0.292, hr: 37, rbi: 112, walk: 78, sb: 4 },
          },
        ],
      }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50, playerType: 'hitter' },
    );

    const speedOnly = result.valuations.find((v) => v.name === 'Speed Only')!;
    const powerStar = result.valuations.find((v) => v.name === 'Power Star')!;
    expect(powerStar.dollarValue).toBeGreaterThan(speedOnly.dollarValue);
  });

  it('keeps strong corner bats above replacement in mixed corner demand leagues', async () => {
    const [league] = await LeagueModel.insertMany([
      {
        ...baseLeague,
        externalId: 'corner-bat-test',
        rosterSlots: {
          ...baseLeague.rosterSlots,
          '1B': 1,
          '3B': 1,
          CI: 1,
        },
      },
    ]);
    await PlayerModel.insertMany([
      hitter({
        externalId: 'corner-star',
        name: 'Corner Star',
        positions: ['3B'],
        stats: [
          {
            season: '2024',
            type: 'hitter',
            data: { ba: 0.287, hr: 31, rbi: 101, walk: 70, sb: 3 },
          },
        ],
      }),
      hitter({
        externalId: 'corner-avg',
        name: 'Corner Average',
        positions: ['3B'],
        stats: [
          {
            season: '2024',
            type: 'hitter',
            data: { ba: 0.266, hr: 18, rbi: 70, walk: 42, sb: 2 },
          },
        ],
      }),
    ]);

    const result = await valuationsService.calculateValuations(
      league._id.toString(),
      { page: 1, limit: 50, playerType: 'hitter' },
    );

    const cornerStar = result.valuations.find((v) => v.name === 'Corner Star')!;
    const cornerAverage = result.valuations.find(
      (v) => v.name === 'Corner Average',
    )!;
    expect(cornerStar.baseValue).toBeGreaterThan(cornerAverage.baseValue);
    expect(cornerStar.baseValue).toBeGreaterThan(1);
  });
});
