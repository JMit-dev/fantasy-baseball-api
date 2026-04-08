import { getAgenda } from '../loaders/agenda.js';
import { playersService } from '../features/players/players.service.js';
import type { DepthChartUpdate } from '../features/players/players.service.js';
import type { DepthChartStatus } from '../features/players/players.types.js';

const ESPN_API_BASE =
  'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb';

/**
 * ESPN team ID → MLB team abbreviation (as returned by statsapi.mlb.com).
 * Abbreviations must match what the player sync job stores in the DB.
 */
const ESPN_TEAM_MAP: Record<number, string> = {
  1: 'BAL',
  2: 'BOS',
  3: 'LAA',
  4: 'CWS',
  5: 'CLE',
  6: 'DET',
  7: 'KC',
  8: 'MIL',
  9: 'MIN',
  10: 'NYY',
  11: 'ATH', // Oakland/Sacramento Athletics
  12: 'SEA',
  13: 'TEX',
  14: 'TOR',
  15: 'ATL',
  16: 'CHC',
  17: 'CIN',
  18: 'HOU',
  19: 'LAD',
  20: 'WSH',
  21: 'NYM',
  22: 'PHI',
  23: 'PIT',
  24: 'STL',
  25: 'SD',
  26: 'SF',
  27: 'COL',
  28: 'MIA',
  29: 'ARI',
  30: 'TB',
};

/** ESPN position abbreviation → our DepthChartStatus rank thresholds are rank-based,
 *  but we still need to know what positions are valid to filter out noise. */
const VALID_ESPN_POSITIONS = new Set([
  'C',
  '1B',
  '2B',
  '3B',
  'SS',
  'LF',
  'CF',
  'RF',
  'OF',
  'DH',
  'SP',
  'RP',
  'CL',
]);

interface ESPNAthlete {
  id: string;
  displayName: string;
}

interface ESPNDepthChartEntry {
  rank: number;
  athlete: ESPNAthlete;
}

interface ESPNPosition {
  name: string;
  abbreviation: string;
}

interface ESPNDepthChart {
  position: ESPNPosition;
  athletes: ESPNDepthChartEntry[];
}

interface ESPNDepthChartResponse {
  depthCharts: ESPNDepthChart[];
}

async function fetchJSON<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`ESPN API error: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

function rankToDepthChartStatus(rank: number): DepthChartStatus {
  if (rank === 1) return 'starter';
  if (rank === 2) return 'backup';
  return 'reserve';
}

async function fetchTeamDepthChart(
  espnTeamId: number,
  mlbAbbr: string,
): Promise<{ team: string; updates: DepthChartUpdate[] }> {
  const url = `${ESPN_API_BASE}/teams/${espnTeamId}/depthcharts`;
  const data = await fetchJSON<ESPNDepthChartResponse>(url);

  const updates: DepthChartUpdate[] = [];
  // Track players already seen so we don't overwrite a higher-priority position entry
  const seen = new Set<string>();

  for (const chart of data.depthCharts) {
    const posAbbr = chart.position.abbreviation.toUpperCase();

    if (!VALID_ESPN_POSITIONS.has(posAbbr)) continue;

    for (const entry of chart.athletes) {
      const name = entry.athlete.displayName;

      // Only record the first (highest-priority) position entry per player
      if (seen.has(name)) continue;
      seen.add(name);

      updates.push({
        name,
        depthChartStatus: rankToDepthChartStatus(entry.rank),
        depthChartOrder: entry.rank,
      });
    }
  }

  return { team: mlbAbbr, updates };
}

async function syncAllDepthCharts(): Promise<void> {
  let totalUpdated = 0;

  for (const [espnId, mlbAbbr] of Object.entries(ESPN_TEAM_MAP)) {
    try {
      console.log(`Fetching depth chart for ${mlbAbbr} (ESPN ID: ${espnId})...`);
      const { team, updates } = await fetchTeamDepthChart(
        Number(espnId),
        mlbAbbr,
      );

      const updated = await playersService.syncTeamDepthCharts(team, updates);
      console.log(`  ${mlbAbbr}: ${updated} players updated (${updates.length} in chart)`);
      totalUpdated += updated;

      // Polite rate limiting between teams
      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch (error) {
      console.error(`Failed to sync depth chart for ${mlbAbbr}:`, error);
      // Continue with other teams
    }
  }

  console.log(`Depth chart sync complete. Total players updated: ${totalUpdated}`);
}

export function defineDepthChartSyncJob() {
  const agenda = getAgenda();

  agenda.define('sync-depth-charts', async () => {
    console.log('Running depth chart sync job...');
    try {
      await syncAllDepthCharts();
    } catch (error) {
      console.error('Depth chart sync failed:', error);
      throw error;
    }
  });
}

// Runs daily at 5 AM — after player sync at 3 AM so players exist in the DB
export async function scheduleDepthChartSync() {
  const agenda = getAgenda();
  await agenda.every('0 5 * * *', 'sync-depth-charts');
  console.log('Depth chart sync job scheduled (daily at 5 AM)');
}

// Manual trigger for admin/testing
export async function triggerDepthChartSyncNow() {
  const agenda = getAgenda();
  await agenda.now('sync-depth-charts');
}
