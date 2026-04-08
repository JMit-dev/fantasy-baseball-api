import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { leaguesService } from './leagues.service.js';
import { LeagueModel } from './leagues.model.js';
import type { LeagueInput } from './leagues.types.js';

describe('LeaguesService', () => {
  const mockLeagues: LeagueInput[] = [
    {
      externalId: 'standard-5x5-roto',
      name: 'Standard 5x5 Roto',
      description: 'Traditional 5x5 rotisserie scoring',
      format: 'roto',
      draftType: 'auction',
      battingCategories: ['R', 'HR', 'RBI', 'SB', 'AVG'],
      pitchingCategories: ['W', 'SV', 'K', 'ERA', 'WHIP'],
      rosterSlots: {
        C: 2,
        '1B': 1,
        '2B': 1,
        '3B': 1,
        SS: 1,
        OF: 5,
        DH: 0,
        SP: 9,
        RP: 4,
        UTIL: 0,
        BENCH: 0,
      },
      totalBudget: 260,
      isDefault: true,
    },
    {
      externalId: 'obp-league',
      name: 'OBP League',
      description: '5x5 league using OBP instead of AVG',
      format: 'roto',
      draftType: 'auction',
      battingCategories: ['R', 'HR', 'RBI', 'SB', 'OBP'],
      pitchingCategories: ['W', 'SV', 'K', 'ERA', 'WHIP'],
      rosterSlots: {
        C: 2,
        '1B': 1,
        '2B': 1,
        '3B': 1,
        SS: 1,
        OF: 5,
        DH: 0,
        SP: 9,
        RP: 4,
        UTIL: 0,
        BENCH: 0,
      },
      totalBudget: 260,
      isDefault: true,
    },
    {
      externalId: 'h2h-points-league',
      name: 'H2H Points League',
      description: 'Head-to-head points scoring',
      format: 'h2h-points',
      draftType: 'snake',
      battingCategories: ['R', 'HR', 'RBI', 'SB', 'AVG'],
      pitchingCategories: ['W', 'SV', 'K', 'ERA', 'WHIP'],
      rosterSlots: {
        C: 1,
        '1B': 1,
        '2B': 1,
        '3B': 1,
        SS: 1,
        OF: 3,
        DH: 1,
        SP: 5,
        RP: 2,
        UTIL: 1,
        BENCH: 3,
      },
      isDefault: false,
    },
    {
      externalId: 'custom-league',
      name: 'My Custom League',
      description: 'User-created custom league',
      format: 'roto',
      draftType: 'auction',
      battingCategories: ['R', 'HR', 'RBI', 'SB', 'OPS'],
      pitchingCategories: ['QS', 'SV+HLD', 'K', 'ERA', 'WHIP'],
      rosterSlots: {
        C: 2,
        '1B': 1,
        '2B': 1,
        '3B': 1,
        SS: 1,
        OF: 5,
        DH: 0,
        SP: 7,
        RP: 6,
        UTIL: 0,
        BENCH: 2,
      },
      totalBudget: 260,
      isDefault: false,
    },
  ];

  beforeEach(async () => {
    // Clear database before each test
    await LeagueModel.deleteMany({});
    // Seed test data
    await LeagueModel.insertMany(mockLeagues);
  });

  afterEach(async () => {
    // Clean up after each test
    await LeagueModel.deleteMany({});
  });

  describe('getLeagues', () => {
    it('should return all leagues with default pagination', async () => {
      const result = await leaguesService.getLeagues();

      expect(result.leagues).toHaveLength(4);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 50,
        total: 4,
      });
    });

    it('should filter leagues by format (roto)', async () => {
      const result = await leaguesService.getLeagues({ format: 'roto' });

      expect(result.leagues).toHaveLength(3);
      expect(result.leagues.every((l) => l.format === 'roto')).toBe(true);
    });

    it('should filter leagues by format (h2h-points)', async () => {
      const result = await leaguesService.getLeagues({ format: 'h2h-points' });

      expect(result.leagues).toHaveLength(1);
      expect(result.leagues[0].name).toBe('H2H Points League');
    });

    it('should filter leagues by draft type (auction)', async () => {
      const result = await leaguesService.getLeagues({ draftType: 'auction' });

      expect(result.leagues).toHaveLength(3);
      expect(result.leagues.every((l) => l.draftType === 'auction')).toBe(true);
    });

    it('should filter leagues by draft type (snake)', async () => {
      const result = await leaguesService.getLeagues({ draftType: 'snake' });

      expect(result.leagues).toHaveLength(1);
      expect(result.leagues[0].name).toBe('H2H Points League');
    });

    it('should filter leagues by isDefault (true)', async () => {
      const result = await leaguesService.getLeagues({ isDefault: true });

      expect(result.leagues).toHaveLength(2);
      expect(result.leagues.every((l) => l.isDefault === true)).toBe(true);
    });

    it('should filter leagues by isDefault (false)', async () => {
      const result = await leaguesService.getLeagues({ isDefault: false });

      expect(result.leagues).toHaveLength(2);
      expect(result.leagues.every((l) => l.isDefault === false)).toBe(true);
    });

    it('should handle pagination correctly', async () => {
      const result = await leaguesService.getLeagues({
        page: 1,
        limit: 2,
      });

      expect(result.leagues).toHaveLength(2);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 2,
        total: 4,
      });
    });

    it('should return second page of results', async () => {
      const result = await leaguesService.getLeagues({
        page: 2,
        limit: 2,
      });

      expect(result.leagues).toHaveLength(2);
      expect(result.pagination.page).toBe(2);
    });

    it('should search leagues by name', async () => {
      const result = await leaguesService.getLeagues({ search: 'OBP' });

      expect(result.leagues).toHaveLength(1);
      expect(result.leagues[0].name).toBe('OBP League');
    });

    it('should combine filters (format + draftType)', async () => {
      const result = await leaguesService.getLeagues({
        format: 'roto',
        draftType: 'auction',
      });

      expect(result.leagues).toHaveLength(3);
      expect(
        result.leagues.every(
          (l) => l.format === 'roto' && l.draftType === 'auction',
        ),
      ).toBe(true);
    });

    it('should combine filters (format + isDefault)', async () => {
      const result = await leaguesService.getLeagues({
        format: 'roto',
        isDefault: true,
      });

      expect(result.leagues).toHaveLength(2);
      expect(
        result.leagues.every(
          (l) => l.format === 'roto' && l.isDefault === true,
        ),
      ).toBe(true);
    });
  });

  describe('getLeagueById', () => {
    it('should return a league by id', async () => {
      const leagues = await LeagueModel.find({
        externalId: 'standard-5x5-roto',
      }).limit(1);
      const league = await leaguesService.getLeagueById(
        leagues[0]._id.toString(),
      );

      expect(league?.name).toBe('Standard 5x5 Roto');
      expect(league?.format).toBe('roto');
      expect(league?.draftType).toBe('auction');
    });

    it('should return null for non-existent id', async () => {
      const league = await leaguesService.getLeagueById(
        '507f1f77bcf86cd799439011',
      );

      expect(league).toBeNull();
    });
  });

  describe('upsertLeague', () => {
    it('should create a new league if externalId does not exist', async () => {
      const newLeague: LeagueInput = {
        externalId: 'new-league-id',
        name: 'New League',
        format: 'roto',
        draftType: 'auction',
        battingCategories: ['R', 'HR', 'RBI', 'SB', 'AVG'],
        pitchingCategories: ['W', 'SV', 'K', 'ERA', 'WHIP'],
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
          UTIL: 0,
          BENCH: 0,
        },
        totalBudget: 200,
        isDefault: false,
      };

      const created = await leaguesService.upsertLeague(newLeague);

      expect(created.name).toBe('New League');
      expect(created.externalId).toBe('new-league-id');
      expect(created.totalBudget).toBe(200);
    });

    it('should update existing league if externalId matches', async () => {
      const updatedLeague: LeagueInput = {
        externalId: 'standard-5x5-roto',
        name: 'Standard 5x5 Roto Updated',
        description: 'Updated description',
        format: 'roto',
        draftType: 'auction',
        battingCategories: ['R', 'HR', 'RBI', 'SB', 'OBP'], // Changed from AVG to OBP
        pitchingCategories: ['W', 'SV', 'K', 'ERA', 'WHIP'],
        rosterSlots: {
          C: 2,
          '1B': 1,
          '2B': 1,
          '3B': 1,
          SS: 1,
          OF: 5,
          DH: 0,
          SP: 9,
          RP: 4,
          UTIL: 0,
          BENCH: 0,
        },
        totalBudget: 300, // Changed from 260 to 300
        taken_players: [
          ['Player One', 'team-1', 'C-0', 25],
          ['Player Two', 'team-1', '1B-0', 10],
        ],
        teams: [['team-1', 'Alpha', 265]],
        isDefault: true,
      };

      const updated = await leaguesService.upsertLeague(updatedLeague);

      expect(updated.name).toBe('Standard 5x5 Roto Updated');
      expect(updated.description).toBe('Updated description');
      expect(updated.battingCategories).toContain('OBP');
      expect(updated.totalBudget).toBe(300);
      expect(updated.taken_players).toEqual([
        ['Player One', 'team-1', 'C-0', 25],
        ['Player Two', 'team-1', '1B-0', 10],
      ]);
      expect(updated.teams).toEqual([['team-1', 'Alpha', 265]]);
    });
  });

  describe('upsertLeagues', () => {
    it('should create multiple new leagues', async () => {
      await LeagueModel.deleteMany({});

      const newLeagues: LeagueInput[] = [
        {
          externalId: 'league-1',
          name: 'League 1',
          format: 'roto',
          draftType: 'auction',
          battingCategories: ['R', 'HR', 'RBI', 'SB', 'AVG'],
          pitchingCategories: ['W', 'SV', 'K', 'ERA', 'WHIP'],
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
            UTIL: 0,
            BENCH: 0,
          },
          isDefault: false,
        },
        {
          externalId: 'league-2',
          name: 'League 2',
          format: 'h2h-points',
          draftType: 'snake',
          battingCategories: ['R', 'HR', 'RBI', 'SB', 'AVG'],
          pitchingCategories: ['W', 'SV', 'K', 'ERA', 'WHIP'],
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
            UTIL: 0,
            BENCH: 0,
          },
          isDefault: false,
        },
      ];

      const count = await leaguesService.upsertLeagues(newLeagues);

      expect(count).toBe(2);

      const allLeagues = await LeagueModel.find({});
      expect(allLeagues).toHaveLength(2);
    });

    it('should update existing leagues and create new ones', async () => {
      const mixedLeagues: LeagueInput[] = [
        {
          externalId: 'standard-5x5-roto', // Existing
          name: 'Standard 5x5 Roto Modified',
          format: 'roto',
          draftType: 'auction',
          battingCategories: ['R', 'HR', 'RBI', 'SB', 'AVG'],
          pitchingCategories: ['W', 'SV', 'K', 'ERA', 'WHIP'],
          rosterSlots: {
            C: 2,
            '1B': 1,
            '2B': 1,
            '3B': 1,
            SS: 1,
            OF: 5,
            DH: 0,
            SP: 9,
            RP: 4,
            UTIL: 0,
            BENCH: 0,
          },
          totalBudget: 260,
          isDefault: true,
        },
        {
          externalId: 'brand-new-league', // New
          name: 'Brand New League',
          format: 'roto',
          draftType: 'auction',
          battingCategories: ['R', 'HR', 'RBI', 'SB', 'AVG'],
          pitchingCategories: ['W', 'SV', 'K', 'ERA', 'WHIP'],
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
            UTIL: 0,
            BENCH: 0,
          },
          isDefault: false,
        },
      ];

      const count = await leaguesService.upsertLeagues(mixedLeagues);

      expect(count).toBe(2); // 1 modified + 1 inserted

      const modified = await LeagueModel.findOne({
        externalId: 'standard-5x5-roto',
      });
      expect(modified?.name).toBe('Standard 5x5 Roto Modified');

      const created = await LeagueModel.findOne({
        externalId: 'brand-new-league',
      });
      expect(created?.name).toBe('Brand New League');
    });
  });

  describe('deleteLeagueById', () => {
    it('should delete and return a league by id', async () => {
      const league = await LeagueModel.findOne({ externalId: 'custom-league' });
      const deletedLeague = await leaguesService.deleteLeagueById(
        league!._id.toString(),
      );

      expect(deletedLeague?.externalId).toBe('custom-league');

      const check = await LeagueModel.findById(league!._id);
      expect(check).toBeNull();
    });

    it('should return null for a non-existent id', async () => {
      const deletedLeague = await leaguesService.deleteLeagueById(
        '507f1f77bcf86cd799439011',
      );

      expect(deletedLeague).toBeNull();
    });
  });
});
