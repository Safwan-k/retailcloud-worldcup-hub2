/**
 * ESPN API provider for FIFA World Cup 2026.
 * Sources:
 *  - Fixtures/scores: site.api.espn.com (scoreboard per date)
 *  - Standings: site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings
 *
 * No API key required. Covers full tournament June 11 – July 26, 2026.
 */

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';
const STANDS_BASE = 'https://site.api.espn.com/apis/v2/sports/soccer/fifa.world';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; RetailcloudWCHub/1.0)',
  'Accept': 'application/json',
};

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`ESPN ${res.status} ${url}`);
  return res.json();
}

// Generate all dates June 11 – July 26 2026
function tournamentDates() {
  const dates = [];
  const start = new Date('2026-06-11T00:00:00Z');
  const end   = new Date('2026-07-26T00:00:00Z');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    dates.push(`${y}${m}${day}`);
  }
  return dates;
}

function mapStatus(ev) {
  const state = ev.status?.type?.state || 'pre';
  const name  = ev.status?.type?.name  || '';
  if (state === 'post' || name === 'STATUS_FINAL') return 'finished';
  if (state === 'in'   || name === 'STATUS_IN_PROGRESS') return 'live';
  return 'upcoming';
}

const PLACEHOLDER_RE = /\b(winner|place|loser|tbd|semifinal|quarterfinal|round of)\b/i;

function parseEvent(ev) {
  const comp = ev.competitions?.[0];
  if (!comp) return null;
  const home = comp.competitors?.find(c => c.homeAway === 'home');
  const away = comp.competitors?.find(c => c.homeAway === 'away');
  if (!home || !away) return null;
  // Skip placeholder knockout matches (teams not yet determined)
  const hn = home.team?.displayName || '';
  const an = away.team?.displayName || '';
  if (PLACEHOLDER_RE.test(hn) || PLACEHOLDER_RE.test(an)) return null;

  const status = mapStatus(ev);
  const scoreA = status !== 'upcoming' ? (parseInt(home.score, 10) || 0) : null;
  const scoreB = status !== 'upcoming' ? (parseInt(away.score, 10) || 0) : null;

  // Penalty shootout scores — ESPN stores per-period linescores on each competitor
  let penaltyA = null, penaltyB = null;
  if (status !== 'upcoming') {
    const findPenalty = (linescores) => (linescores || []).find(
      ls => ls.period === 5 || ls.periodNumber === 5 ||
            (ls.periodText || ls.periodType || '').toLowerCase().includes('pen')
    );
    const hp = findPenalty(home.linescores);
    const ap = findPenalty(away.linescores);
    if (hp != null && ap != null) {
      penaltyA = parseInt(hp.value ?? hp.score, 10) || 0;
      penaltyB = parseInt(ap.value ?? ap.score, 10) || 0;
    }
  }

  // Stage / group from season notes or competition notes
  const notes = comp.notes?.[0]?.text || '';
  const seasonSlug = ev.season?.slug || '';
  let stage = 'Group Stage';
  let groupName = null;
  if (notes.toLowerCase().includes('group')) {
    const gm = notes.match(/Group\s+([A-Z])/i);
    if (gm) groupName = gm[1].toUpperCase();
    stage = 'Group Stage';
  } else if (seasonSlug.includes('round-of')) {
    stage = seasonSlug.includes('32') ? 'Round of 32' : 'Round of 16';
  } else if (seasonSlug.includes('quarter')) {
    stage = 'Quarter-final';
  } else if (seasonSlug.includes('semi')) {
    stage = 'Semi-final';
  } else if (seasonSlug.includes('final')) {
    stage = 'Final';
  }

  return {
    extId:     `espn-${ev.id}`,
    teamAName: home.team?.displayName,
    teamBName: away.team?.displayName,
    teamAFlag: home.team?.logos?.[0]?.href || null,
    teamBFlag: away.team?.logos?.[0]?.href || null,
    kickoff:   new Date(ev.date).toISOString(),
    stage,
    groupName,
    status,
    scoreA,
    scoreB,
    penaltyA,
    penaltyB,
  };
}

async function fetchFixtures() {
  const dates = tournamentDates();
  const results = [];

  // Fetch in parallel chunks of 8 to be polite
  for (let i = 0; i < dates.length; i += 8) {
    const chunk = dates.slice(i, i + 8);
    const responses = await Promise.all(
      chunk.map(d => getJson(`${BASE}/scoreboard?dates=${d}&limit=20`).catch(() => null))
    );
    for (const data of responses) {
      if (!data?.events) continue;
      for (const ev of data.events) {
        const parsed = parseEvent(ev);
        if (parsed) results.push(parsed);
      }
    }
  }
  return results;
}

// Quick fetch: only today ± 3 days (for live-agent polling)
async function fetchRecentFixtures() {
  const now = new Date();
  const dates = [];
  for (let offset = -1; offset <= 3; offset++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + offset);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    dates.push(`${y}${m}${day}`);
  }
  const responses = await Promise.all(
    dates.map(d => getJson(`${BASE}/scoreboard?dates=${d}&limit=20`).catch(() => null))
  );
  const results = [];
  for (const data of responses) {
    if (!data?.events) continue;
    for (const ev of data.events) {
      const parsed = parseEvent(ev);
      if (parsed) results.push(parsed);
    }
  }
  return results;
}

async function fetchTeams() {
  const data = await getJson(`${STANDS_BASE}/standings`);
  const teams = [];
  const seen = new Set();
  for (const group of (data.children || [])) {
    const groupName = group.abbreviation || group.name?.replace('Group ', '') || null;
    for (const entry of (group.standings?.entries || [])) {
      const t = entry.team;
      if (!t || seen.has(t.id)) continue;
      if (PLACEHOLDER_RE.test(t.displayName || '')) continue;
      seen.add(t.id);
      teams.push({
        extId:     `espn-team-${t.id}`,
        name:      t.displayName,
        code:      t.abbreviation || null,
        flag:      t.logos?.[0]?.href || null,
        groupName: groupName,
      });
    }
  }
  return teams;
}

async function fetchStandings() {
  const data = await getJson(`${STANDS_BASE}/standings`);
  const groups = [];
  for (const group of (data.children || [])) {
    const groupName = group.name || `Group ${group.abbreviation}`;
    const rows = [];
    for (const entry of (group.standings?.entries || [])) {
      const t = entry.team;
      const stats = {};
      for (const s of (entry.stats || [])) stats[s.name] = s.value;
      rows.push({
        teamName:   t.displayName,
        teamCode:   t.abbreviation,
        teamFlag:   t.logos?.[0]?.href || null,
        played:     stats.gamesPlayed    || 0,
        won:        stats.wins           || 0,
        drawn:      stats.ties           || 0,
        lost:       stats.losses         || 0,
        goalsFor:   stats.pointsFor      || 0,
        goalsAgainst: stats.pointsAgainst || 0,
        goalDiff:   stats.pointDifferential || 0,
        points:     stats.points         || 0,
        rank:       entry.stats?.find(s => s.name === 'rank')?.value || rows.length + 1,
      });
    }
    groups.push({ groupName, rows });
  }
  return groups;
}

async function fetchMatchSummary(espnEventId) {
  try {
    const data = await getJson(`${BASE}/summary?event=${espnEventId}`);
    const comp = data.header?.competitions?.[0];
    const homeId = comp?.competitors?.find(c => c.homeAway === 'home')?.team?.id;
    const awayId = comp?.competitors?.find(c => c.homeAway === 'away')?.team?.id;
    const goals = [];
    for (const play of (data.scoringPlays || [])) {
      const minute = play.clock?.displayValue || '?';
      const teamId = String(play.team?.id || '');
      const player = play.participants?.[0]?.athlete?.shortName
        || play.participants?.[0]?.athlete?.displayName || '';
      const side = teamId === String(homeId) ? 'A' : teamId === String(awayId) ? 'B' : '?';
      if (player) goals.push({ minute, player, side });
    }
    return goals;
  } catch {
    return null;
  }
}

module.exports = { name: 'espn', fetchTeams, fetchFixtures, fetchRecentFixtures, fetchStandings, fetchMatchSummary };
