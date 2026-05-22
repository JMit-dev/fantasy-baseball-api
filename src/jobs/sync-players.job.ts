import { getAgenda } from '../loaders/agenda.js';
import { PlayerModel } from '../features/players/players.model.js';
import { playersService } from '../features/players/players.service.js';
import type {
  Player,
  PlayerInput,
  PlayerPosition,
} from '../features/players/players.types.js';
import { notificationsService } from '../features/notifications/notifications.service.js';

const MLB_API_BASE = 'https://statsapi.mlb.com/api/v1';
const LAST_SEASON = new Date().getFullYear() - 1;
const ELIGIBLE_GAMES_THRESHOLD = 20;

interface MLBTeam {
  id: number;
  name: string;
  abbreviation: string;
  league: { id: number; name: string };
}

interface MLBPlayer {
  id: number;
  fullName: string;
  primaryPosition?: { code: string; abbreviation: string };
  birthDate?: string;
  currentAge?: number;
  height?: string;
  weight?: number;
  batSide?: { code: string };
  pitchHand?: { code: string };
  mlbDebutDate?: string;
  active?: boolean;
}

interface MLBPlayerDetailResponse {
  people: MLBPlayer[];
}

interface MLBRosterEntry {
  person: MLBPlayer;
  jerseyNumber?: string;
  position: { abbreviation: string };
  status: { code: string; description: string };
}

interface MLBRosterResponse {
  roster: MLBRosterEntry[];
}

interface MLBStatSplit {
  season: string;
  stat: Record<string, unknown>;
}

interface MLBStatsResponse {
  stats: Array<{ splits: MLBStatSplit[] }>;
}

interface MLBFieldingStats {
  stats: Array<{
    splits: Array<{
      stat: { games?: number };
      position: { abbreviation: string };
    }>;
  }>;
}

// Maps MLB position abbreviations → our PlayerPosition enum values
const POSITION_MAP: Record<string, PlayerPosition> = {
  C: 'C',
  '1B': '1B',
  '2B': '2B',
  '3B': '3B',
  SS: 'SS',
  LF: 'OF',
  CF: 'OF',
  RF: 'OF',
  OF: 'OF',
  DH: 'DH',
  SP: 'SP',
  RP: 'RP',
  // Generic pitcher falls back to SP unless primaryPosition says otherwise
  P: 'SP',
};

function toPlayerPosition(abbr: string): PlayerPosition | null {
  return POSITION_MAP[abbr] ?? null;
}

async function fetchJSON<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`MLB API error: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

async function getAllTeams(): Promise<MLBTeam[]> {
  const currentYear = new Date().getFullYear();
  const response = await fetchJSON<{ teams: MLBTeam[] }>(
    `${MLB_API_BASE}/teams?sportId=1&season=${currentYear}`,
  );
  return response.teams.filter(
    (t) => t.league.id === 103 || t.league.id === 104,
  );
}

async function getTeamRoster(teamId: number): Promise<MLBRosterResponse> {
  return fetchJSON<MLBRosterResponse>(
    `${MLB_API_BASE}/teams/${teamId}/roster/40Man`,
  );
}

async function getPlayerDetails(playerId: number): Promise<MLBPlayer | null> {
  try {
    const response = await fetchJSON<MLBPlayerDetailResponse>(
      `${MLB_API_BASE}/people/${playerId}`,
    );
    return response.people[0] ?? null;
  } catch {
    return null;
  }
}

// Fetches last season's fielding stats to determine multi-position eligibility
async function getFieldingPositions(
  playerId: number,
): Promise<PlayerPosition[]> {
  try {
    const data = await fetchJSON<MLBFieldingStats>(
      `${MLB_API_BASE}/people/${playerId}/stats?stats=season&group=fielding&season=${LAST_SEASON}`,
    );
    const splits = data.stats[0]?.splits ?? [];
    const positions: PlayerPosition[] = [];
    for (const split of splits) {
      if ((split.stat.games ?? 0) >= ELIGIBLE_GAMES_THRESHOLD) {
        const pos = toPlayerPosition(split.position.abbreviation);
        // Exclude pitching positions from fielding eligibility
        if (pos && pos !== 'SP' && pos !== 'RP') positions.push(pos);
      }
    }
    return positions;
  } catch {
    return [];
  }
}

// Fetches up to 3 seasons of hitting or pitching stats from the MLB API
async function getPlayerHistoricalStats(
  playerId: number,
  isPitcher: boolean,
): Promise<PlayerInput['stats']> {
  const group = isPitcher ? 'pitching' : 'hitting';
  try {
    const data = await fetchJSON<MLBStatsResponse>(
      `${MLB_API_BASE}/people/${playerId}/stats?stats=yearByYear&group=${group}&sportId=1`,
    );
    const splits = data.stats[0]?.splits ?? [];
    const currentYear = new Date().getFullYear();

    // Take the 3 most recent completed seasons
    const recent = splits
      .filter((s) => Number(s.season) < currentYear)
      .slice(-3);

    if (isPitcher) {
      return recent.map((s) => ({
        season: s.season,
        type: 'pitcher' as const,
        data: {
          era: Number(s.stat['era']) || undefined,
          wins: Number(s.stat['wins']) || undefined,
          losses: Number(s.stat['losses']) || undefined,
          saves: Number(s.stat['saves']) || undefined,
          strikeouts: Number(s.stat['strikeOuts']) || undefined,
          innings:
            parseFloat(String(s.stat['inningsPitched'] ?? '')) || undefined,
          whip:
            parseFloat(String(s.stat['whip'] ?? '')) || undefined,
        },
      }));
    }
    return recent.map((s) => ({
      season: s.season,
      type: 'hitter' as const,
      data: {
        ba: Number(s.stat['avg']) || undefined,
        hr: Number(s.stat['homeRuns']) || undefined,
        rbi: Number(s.stat['rbi']) || undefined,
        walk: Number(s.stat['baseOnBalls']) || undefined,
        sb: Number(s.stat['stolenBases']) || undefined,
        r: Number(s.stat['runs']) || undefined,
      },
    }));
  } catch {
    return [];
  }
}

async function buildPositions(
  playerId: number,
  rosterAbbr: string,
  primaryAbbr: string | undefined,
  isPitcher: boolean,
): Promise<PlayerPosition[]> {
  if (isPitcher) {
    // Use primaryPosition to correctly differentiate SP vs RP
    const resolved = toPlayerPosition(primaryAbbr ?? rosterAbbr) ?? 'SP';
    // Clamp to only pitcher positions
    return resolved === 'RP' ? ['RP'] : ['SP'];
  }

  const posSet = new Set<PlayerPosition>();

  const fromRoster = toPlayerPosition(rosterAbbr);
  if (fromRoster && fromRoster !== 'SP' && fromRoster !== 'RP')
    posSet.add(fromRoster);

  const fromPrimary = toPlayerPosition(primaryAbbr ?? '');
  if (fromPrimary && fromPrimary !== 'SP' && fromPrimary !== 'RP')
    posSet.add(fromPrimary);

  // Fetch fielding stats for multi-position eligibility
  const fieldingPositions = await getFieldingPositions(playerId);
  await new Promise((r) => setTimeout(r, 50));
  for (const pos of fieldingPositions) posSet.add(pos);

  return posSet.size > 0 ? Array.from(posSet) : ['DH'];
}

function isPitcherPosition(
  rosterAbbr: string,
  primaryAbbr: string | undefined,
): boolean {
  const abbr = primaryAbbr ?? rosterAbbr;
  return abbr === 'SP' || abbr === 'RP' || abbr === 'P' || rosterAbbr === 'P';
}

function mapInjuryStatus(statusCode: string): PlayerInput['injuryStatus'] {
  const statusMap: Record<string, PlayerInput['injuryStatus']> = {
    A: 'active',
    D10: 'il-10',
    D15: 'il-15',
    D60: 'il-60',
    DTD: 'day-to-day',
    OUT: 'out',
  };
  return statusMap[statusCode] ?? 'active';
}

const PLAYER_DETAILS_CATEGORY = {
  depthChart: 'Player Details - Depth Chart',
  transactionStatus: 'Player Details - Transactions/Contract Status',
  injuryNews: 'Player Details - Injury/News',
} as const;

type PlayerChangeCategory =
  (typeof PLAYER_DETAILS_CATEGORY)[keyof typeof PLAYER_DETAILS_CATEGORY];

type TrackedPlayerChange = {
  playerId: string;
  playerName: string;
  team: string;
  changedCategories: PlayerChangeCategory[];
  previousValues: Record<string, unknown>;
  nextValues: Record<string, unknown>;
};

function normalizeString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePositions(positions: string[] | undefined): string[] {
  return [...(positions ?? [])].sort();
}

function arraysEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function buildPlayerChangeMessage(change: TrackedPlayerChange): string {
  return `${change.playerName} (${change.team}) updated: ${change.changedCategories.join(', ')}`;
}

async function pushLeagueScopedPlayerNotifications(
  changes: TrackedPlayerChange[],
): Promise<void> {
  if (changes.length === 0) {
    return;
  }

  const targetsByPlayerId =
    await notificationsService.resolveTargetUserIdsByPlayerIds(
      changes.map((change) => change.playerId),
    );

  for (const change of changes) {
    const targetUserIds = targetsByPlayerId[change.playerId] ?? [];

    if (targetUserIds.length === 0) {
      continue;
    }

    await notificationsService.push({
      type: 'player-details-updated',
      message: buildPlayerChangeMessage(change),
      data: {
        playerId: change.playerId,
        playerName: change.playerName,
        team: change.team,
        changedCategories: change.changedCategories,
        previousValues: change.previousValues,
        nextValues: change.nextValues,
        syncedAt: new Date().toISOString(),
      },
      targetUserIds,
    });
  }
}

function detectPlayerDetailsChanges(
  previousPlayer: Player,
  nextPlayer: PlayerInput,
): TrackedPlayerChange | null {
  const changedCategories: PlayerChangeCategory[] = [];

  const previousPositions = normalizePositions(previousPlayer.positions);
  const nextPositions = normalizePositions(nextPlayer.positions);

  if (!arraysEqual(previousPositions, nextPositions)) {
    changedCategories.push(PLAYER_DETAILS_CATEGORY.depthChart);
  }

  const previousTransactionStatus = normalizeString(
    previousPlayer.transactionStatus,
  );
  const nextTransactionStatus = normalizeString(nextPlayer.transactionStatus);

  if (
    previousPlayer.team !== nextPlayer.team ||
    (previousPlayer.active ?? true) !== (nextPlayer.active ?? true) ||
    previousTransactionStatus !== nextTransactionStatus
  ) {
    changedCategories.push(PLAYER_DETAILS_CATEGORY.transactionStatus);
  }

  const previousInjuryStatus = previousPlayer.injuryStatus ?? 'active';
  const nextInjuryStatus = nextPlayer.injuryStatus ?? 'active';
  const previousInjuryNote = normalizeString(previousPlayer.injuryNote);
  const nextInjuryNote = normalizeString(nextPlayer.injuryNote);

  if (
    previousInjuryStatus !== nextInjuryStatus ||
    previousInjuryNote !== nextInjuryNote
  ) {
    changedCategories.push(PLAYER_DETAILS_CATEGORY.injuryNews);
  }

  if (changedCategories.length === 0) {
    return null;
  }

  return {
    playerId: String(previousPlayer._id),
    playerName: nextPlayer.name,
    team: nextPlayer.team,
    changedCategories,
    previousValues: {
      positions: previousPositions,
      team: previousPlayer.team,
      active: previousPlayer.active ?? true,
      transactionStatus: previousTransactionStatus,
      injuryStatus: previousInjuryStatus,
      injuryNote: previousInjuryNote,
    },
    nextValues: {
      positions: nextPositions,
      team: nextPlayer.team,
      active: nextPlayer.active ?? true,
      transactionStatus: nextTransactionStatus,
      injuryStatus: nextInjuryStatus,
      injuryNote: nextInjuryNote,
    },
  };
}

async function fetchAllMLBPlayers(): Promise<PlayerInput[]> {
  console.log('Fetching all MLB teams...');
  const teams = await getAllTeams();
  console.log(`Found ${teams.length} teams`);

  const allPlayers: PlayerInput[] = [];

  for (const team of teams) {
    try {
      console.log(`Fetching roster for ${team.name}...`);
      const roster = await getTeamRoster(team.id);

      if (!roster.roster?.length) {
        console.log(`  ⚠️ Empty roster for ${team.name}`);
        continue;
      }

      for (const entry of roster.roster) {
        const player = entry.person;
        const playerDetails = await getPlayerDetails(player.id);
        await new Promise((r) => setTimeout(r, 50));

        const league = (team.league.id === 103 ? 'AL' : 'NL') as 'AL' | 'NL';
        const rosterAbbr = entry.position.abbreviation;
        const primaryAbbr = playerDetails?.primaryPosition?.abbreviation;
        const isPitcher = isPitcherPosition(rosterAbbr, primaryAbbr);

        const positions = await buildPositions(
          player.id,
          rosterAbbr,
          primaryAbbr,
          isPitcher,
        );
        const playerType: 'hitter' | 'pitcher' = isPitcher
          ? 'pitcher'
          : 'hitter';
        const injuryStatus = mapInjuryStatus(entry.status.code);

        const stats = await getPlayerHistoricalStats(player.id, isPitcher);
        await new Promise((r) => setTimeout(r, 50));

        const base = {
          externalId: `mlb-${player.id}`,
          name: player.fullName,
          team: team.abbreviation,
          positions,
          league,
          jerseyNumber: entry.jerseyNumber,
          transactionStatus: entry.status.description,
          injuryStatus,
          birthDate: playerDetails?.birthDate,
          age: playerDetails?.currentAge,
          height: playerDetails?.height,
          weight: playerDetails?.weight,
          mlbDebutDate: playerDetails?.mlbDebutDate,
          active: playerDetails?.active ?? true,
          stats,
        };

        const playerInput: PlayerInput =
          playerType === 'pitcher'
            ? {
                ...base,
                playerType: 'pitcher' as const,
                pitchHand: playerDetails?.pitchHand?.code as
                  | 'R'
                  | 'L'
                  | undefined,
              }
            : {
                ...base,
                playerType: 'hitter' as const,
                batSide: playerDetails?.batSide?.code as
                  | 'R'
                  | 'L'
                  | 'S'
                  | undefined,
              };

        allPlayers.push(playerInput);
      }
    } catch (error) {
      console.error(`Failed to fetch roster for ${team.name}:`, error);
    }
  }

  console.log(`Successfully fetched ${allPlayers.length} players`);
  return allPlayers;
}

export { fetchAllMLBPlayers as fetchAllMLBPlayersForScript };

export function definePlayerSyncJob() {
  const agenda = getAgenda();

  agenda.define('sync-players', async () => {
    console.log('Running player sync job...');
    try {
      const externalPlayers = await fetchAllMLBPlayers();
      const existingPlayers = await PlayerModel.find(
        {
          externalId: {
            $in: externalPlayers.map((player) => player.externalId),
          },
        },
        {
          _id: 1,
          externalId: 1,
          name: 1,
          team: 1,
          positions: 1,
          transactionStatus: 1,
          injuryStatus: 1,
          injuryNote: 1,
          active: 1,
        },
      ).lean();
      const existingPlayersByExternalId = new Map(
        (existingPlayers as Player[]).map((player) => [
          player.externalId,
          player,
        ]),
      );
      const trackedChanges = externalPlayers.flatMap((player) => {
        const previousPlayer = existingPlayersByExternalId.get(
          player.externalId,
        );
        const change =
          previousPlayer !== undefined
            ? detectPlayerDetailsChanges(previousPlayer, player)
            : null;

        return change ? [change] : [];
      });
      const updatedCount = await playersService.upsertPlayers(externalPlayers);
      await pushLeagueScopedPlayerNotifications(trackedChanges);
      console.log(
        `Synced ${externalPlayers.length} players (${updatedCount} updated/inserted)`,
      );
      notificationsService.push({
        type: 'players-updated',
        message: `Player roster synced — ${updatedCount} players updated`,
        data: {
          total: externalPlayers.length,
          updated: updatedCount,
          syncedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('Player sync failed:', error);
      throw error;
    }
  });
}

export async function schedulePlayerSync() {
  const agenda = getAgenda();
  await agenda.every('0 3 * * *', 'sync-players');
  console.log('Player sync job scheduled (daily at 3 AM)');
}

export async function triggerPlayerSyncNow() {
  const agenda = getAgenda();
  await agenda.now('sync-players');
}
