/**
 * TheSportsDB provider (free tier works with key "3"; set THESPORTSDB_KEY for paid tier).
 * FIFA World Cup league id: 4429. Season configurable via WORLDCUP_SEASON (default 2026).
 */
const API_KEY = process.env.THESPORTSDB_KEY || '3';
const SEASON = process.env.WORLDCUP_SEASON || '2026';
const LEAGUE_ID = process.env.THESPORTSDB_LEAGUE_ID || '4429';
const BASE = `https://www.thesportsdb.com/api/v1/json/${API_KEY}`;

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TheSportsDB ${res.status} for ${url}`);
  return res.json();
}

function mapStatus(ev) {
  const s = (ev.strStatus || '').toLowerCase();
  if (['ft', 'aet', 'pen', 'match finished', 'finished'].includes(s)) return 'finished';
  // strProgress can be "0" / "" for not-started events — only treat a real
  // positive progress value as live, otherwise upcoming games flash as live.
  const progress = ev.strProgress && ev.strProgress !== '0' ? ev.strProgress : null;
  if (['1h', '2h', 'ht', 'et', 'live', 'in play'].includes(s) || progress) return 'live';
  if (ev.intHomeScore != null && ev.intAwayScore != null) {
    // Past event with scores but no explicit status.
    const ts = Date.parse(`${ev.dateEvent}T${ev.strTime || '00:00:00'}Z`);
    if (ts < Date.now() - 3 * 60 * 60 * 1000) return 'finished';
  }
  return 'upcoming';
}

async function fetchTeams() {
  const data = await getJson(`${BASE}/lookup_all_teams.php?id=${LEAGUE_ID}`);
  return (data.teams || []).map(t => ({
    extId: t.idTeam,
    name: t.strTeam,
    code: t.strTeamShort || null,
    flag: t.strBadge || null, // badge URL; frontend falls back to emoji map
    groupName: null,
  }));
}

async function fetchFixtures() {
  const data = await getJson(`${BASE}/eventsseason.php?id=${LEAGUE_ID}&s=${SEASON}`);
  return (data.events || []).map(ev => ({
    extId: ev.idEvent,
    teamAName: ev.strHomeTeam,
    teamBName: ev.strAwayTeam,
    kickoff: ev.strTimestamp
      ? new Date(ev.strTimestamp).toISOString()
      : new Date(`${ev.dateEvent}T${ev.strTime || '12:00:00'}Z`).toISOString(),
    stage: ev.strStage || ev.intRound ? `Round ${ev.intRound}` : 'Group Stage',
    groupName: ev.strGroup || null,
    status: mapStatus(ev),
    scoreA: ev.intHomeScore != null ? Number(ev.intHomeScore) : null,
    scoreB: ev.intAwayScore != null ? Number(ev.intAwayScore) : null,
  }));
}

module.exports = { name: 'thesportsdb', fetchTeams, fetchFixtures };
