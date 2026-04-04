import { LeagueModel } from './leagues.model.js';
import type { League, LeagueFilters } from './leagues.types.js';

export class LeaguesService {
  async getLeagues(filters: LeagueFilters = {}) {
    const {
      format,
      draftType,
      isDefault,
      search,
      page = 1,
      limit = 50,
    } = filters;

    const query: Record<string, unknown> = {};

    // Filter by format
    if (format) {
      query.format = format;
    }

    // Filter by draft type
    if (draftType) {
      query.draftType = draftType;
    }

    // Filter by default status
    if (isDefault !== undefined) {
      query.isDefault = isDefault;
    }

    // Search by name/description
    if (search) {
      query.$text = { $search: search };
    }

    const skip = (page - 1) * limit;

    const [leagues, total] = await Promise.all([
      LeagueModel.find(query)
        .sort({ isDefault: -1, name: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      LeagueModel.countDocuments(query),
    ]);

    return {
      leagues,
      pagination: {
        page,
        limit,
        total,
      },
    };
  }

  async getLeagueById(id: string): Promise<League | null> {
    return LeagueModel.findById(id).lean();
  }

  async upsertLeague(
    leagueData: Omit<League, '_id' | 'createdAt' | 'updatedAt'>,
  ): Promise<League> {
    const updated = await LeagueModel.findOneAndUpdate(
      { externalId: leagueData.externalId },
      leagueData,
      { upsert: true, new: true, runValidators: true },
    ).lean();

    return updated!;
  }

  async upsertLeagues(
    leagues: Omit<League, '_id' | 'createdAt' | 'updatedAt'>[],
  ): Promise<number> {
    const operations = leagues.map((league) => ({
      updateOne: {
        filter: { externalId: league.externalId },
        update: { $set: league },
        upsert: true,
      },
    }));

    const result = await LeagueModel.bulkWrite(operations, { ordered: false });
    return result.upsertedCount + result.modifiedCount;
  }

  async deleteLeagueById(id: string): Promise<League | null> {
    return LeagueModel.findByIdAndDelete(id).lean();
  }
}

export const leaguesService = new LeaguesService();
