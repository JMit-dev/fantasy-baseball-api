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

/**
 * ESPN position keys (lowercase) to ignore — 'p' is the generic "pitcher"
 * bucket which duplicates SP/RP entries; we use the specific positions instead.
 */
const SKIP_ESPN_POSITIONS = new Set(['p']);

interface ESPNAthlete {
  id: string;
  displayName: string;
}

interface ESPNPositionEntry {
  position: { name: string; abbreviation: string };
  /** Athletes ordered by depth chart rank (index 0 = starter). */
  athletes: ESPNAthlete[];
}

interface ESPNDepthChartGroup {
  id: string;
  name: string;
  /** Keys are lowercase position abbreviations: 'c', '1b', 'sp', 'rp', 'cl', etc. */
  positions: Record<string, ESPNPositionEntry>;
}

interface ESPNDepthChartResponse {
  /** ESPN returns a single-element array named "depthchart" (lowercase). */
  depthchart: ESPNDepthChartGroup[];
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
  // Track players already seen so we record only their primary (first) position
  const seen = new Set<string>();

  const positionsMap = data.depthchart[0]?.positions ?? {};

  for (const [posKey, posEntry] of Object.entries(positionsMap)) {
    // Skip generic 'p' (pitcher) bucket — it duplicates sp/rp entries
    if (SKIP_ESPN_POSITIONS.has(posKey)) continue;

    posEntry.athletes.forEach((athlete, index) => {
      const name = athlete.displayName;
      if (seen.has(name)) return;
      seen.add(name);

      // Array index is 0-based; rank is 1-based
      const rank = index + 1;
      updates.push({
        name,
        depthChartStatus: rankToDepthChartStatus(rank),
        depthChartOrder: rank,
      });
    });
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
