import { PlayerModel } from './players.model.js';
import type { DepthChartStatus, Player, PlayerFilters } from './players.types.js';

export interface DepthChartUpdate {
  name: string;
  depthChartStatus: DepthChartStatus;
  depthChartOrder: number;
}

export class PlayersService {
  async getPlayers(filters: PlayerFilters = {}) {
    const {
      league,
      position,
      playerType,
      search,
      page = 1,
      limit = 50,
    } = filters;

    const query: Record<string, unknown> = {};

    // Filter by league
    if (league && league !== 'MLB') {
      query.league = league;
    }

    // Filter by position
    if (position) {
      query.positions = position;
    }

    // Filter by player type
    if (playerType) {
      query.playerType = playerType;
    }

    // Search by name
    if (search) {
      query.$text = { $search: search };
    }

    const skip = (page - 1) * limit;

    const [players, total] = await Promise.all([
      PlayerModel.find(query).sort({ name: 1 }).skip(skip).limit(limit).lean(),
      PlayerModel.countDocuments(query),
    ]);

    return {
      players,
      pagination: {
        page,
        limit,
        total,
      },
    };
  }

  async getPlayerById(id: string): Promise<Player | null> {
    return PlayerModel.findById(id).lean();
  }

  async createPlayer(
    playerData: Omit<Player, '_id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Player> {
    const player = new PlayerModel(playerData);
    return player.save();
  }

  async upsertPlayer(
    playerData: Omit<Player, '_id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Player> {
    const updated = await PlayerModel.findOneAndUpdate(
      { externalId: playerData.externalId },
      playerData,
      { upsert: true, new: true, runValidators: true },
    ).lean();

    return updated!;
  }

  async upsertPlayers(
    players: Omit<Player, '_id' | 'createdAt' | 'updatedAt'>[],
  ): Promise<number> {
    const operations = players.map((player) => ({
      updateOne: {
        filter: { externalId: player.externalId },
        update: { $set: player },
        upsert: true,
      },
    }));

    const result = await PlayerModel.bulkWrite(operations, { ordered: false });
    return result.upsertedCount + result.modifiedCount;
  }

  async seedPlayers(
    players: Omit<Player, '_id' | 'createdAt' | 'updatedAt'>[],
  ): Promise<void> {
    await PlayerModel.insertMany(players);
  }

  async syncTeamDepthCharts(
    team: string,
    updates: DepthChartUpdate[],
  ): Promise<number> {
    // Clear existing depth chart data for all players on this team
    await PlayerModel.updateMany(
      { team },
      { $unset: { depthChartStatus: '', depthChartOrder: '' } },
    );

    if (updates.length === 0) return 0;

    const operations = updates.map((u) => ({
      updateOne: {
        filter: { name: u.name, team },
        update: {
          $set: {
            depthChartStatus: u.depthChartStatus,
            depthChartOrder: u.depthChartOrder,
          },
        },
      },
    }));

    const result = await PlayerModel.bulkWrite(operations, { ordered: false });
    return result.modifiedCount;
  }
}

export const playersService = new PlayersService();
