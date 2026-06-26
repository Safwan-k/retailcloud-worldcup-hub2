const db = require('../db');
const { getProvider } = require('./provider');
const { recalcMatch } = require('../points');
const seed = require('./seed');

const upsertTeam = db.prepare(`
  INSERT INTO teams (ext_id, name, code, flag, group_name)
  VALUES (@extId, @name, @code, @flag, @groupName)
  ON CONFLICT(name) DO UPDATE SET
    ext_id    = COALESCE(excluded.ext_id,     teams.ext_id),
    code      = COALESCE(excluded.code,       teams.code),
    flag      = COALESCE(excluded.flag,       teams.flag),
    group_name= COALESCE(excluded.group_name, teams.group_name)
`);

function teamIdByName(name) {
  const row = db.prepare('SELECT id FROM teams WHERE name = ?').get(name);
  if (row) return row.id;
  const info = db.prepare('INSERT INTO teams (name) VALUES (?)').run(name);
  return info.lastInsertRowid;
}

// Also update the team flag when we see it in a fixture (ESPN embeds logos per event)
const updateTeamFlag = db.prepare(`
  UPDATE teams SET flag = ? WHERE name = ? AND (flag IS NULL OR flag = '')
`);

// Upsert fixtures; returns ids of matches whose result/status changed.
const applyFixtures = db.transaction((fixtures) => {
  const changed = [];
  const find   = db.prepare('SELECT * FROM matches WHERE ext_id = ?');
  const insert = db.prepare(`
    INSERT INTO matches (ext_id, team_a_id, team_b_id, kickoff, stage, group_name, status, score_a, score_b, penalty_a, penalty_b)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const update = db.prepare(`
    UPDATE matches SET kickoff = ?, stage = ?, group_name = ?, status = ?, score_a = ?, score_b = ?,
      penalty_a = ?, penalty_b = ?, updated_at = datetime('now') WHERE id = ?
  `);
  for (const f of fixtures) {
    const aId = teamIdByName(f.teamAName);
    const bId = teamIdByName(f.teamBName);
    // Keep team flags in sync
    if (f.teamAFlag) updateTeamFlag.run(f.teamAFlag, f.teamAName);
    if (f.teamBFlag) updateTeamFlag.run(f.teamBFlag, f.teamBName);

    const existing = find.get(f.extId);
    if (!existing) {
      const info = insert.run(f.extId, aId, bId, f.kickoff, f.stage, f.groupName, f.status, f.scoreA, f.scoreB, f.penaltyA ?? null, f.penaltyB ?? null);
      if (f.status === 'finished') changed.push(info.lastInsertRowid);
    } else {
      const resultChanged =
        existing.status !== f.status ||
        existing.score_a !== f.scoreA ||
        existing.score_b !== f.scoreB ||
        existing.penalty_a !== (f.penaltyA ?? null) ||
        existing.penalty_b !== (f.penaltyB ?? null);
      update.run(f.kickoff, f.stage, f.groupName, f.status, f.scoreA, f.scoreB, f.penaltyA ?? null, f.penaltyB ?? null, existing.id);
      if (resultChanged) changed.push(existing.id);
    }
  }
  return changed;
});

const upsertStanding = db.prepare(`
  INSERT INTO standings
    (group_name, team_name, team_code, team_flag, played, won, drawn, lost,
     goals_for, goals_against, goal_diff, points, position, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(group_name, team_name) DO UPDATE SET
    team_code     = excluded.team_code,
    team_flag     = excluded.team_flag,
    played        = excluded.played,
    won           = excluded.won,
    drawn         = excluded.drawn,
    lost          = excluded.lost,
    goals_for     = excluded.goals_for,
    goals_against = excluded.goals_against,
    goal_diff     = excluded.goal_diff,
    points        = excluded.points,
    position      = excluded.position,
    updated_at    = datetime('now')
`);

function applyStandings(groups) {
  for (const g of groups) {
    for (const row of g.rows) {
      upsertStanding.run(
        g.groupName, row.teamName, row.teamCode, row.teamFlag,
        row.played, row.won, row.drawn, row.lost,
        row.goalsFor, row.goalsAgainst, row.goalDiff, row.points, row.rank || 0
      );
    }
  }
}

// Full sync — all fixtures + teams + standings (used by Admin → Sync and on boot)
async function syncFromProvider() {
  const provider = getProvider();
  // Remove seed placeholders once real data is available
  db.prepare("DELETE FROM matches WHERE ext_id LIKE 'seed-%'").run();
  const [teams, fixtures, standingGroups] = await Promise.all([
    provider.fetchTeams(),
    provider.fetchFixtures(),
    typeof provider.fetchStandings === 'function' ? provider.fetchStandings() : Promise.resolve([]),
  ]);
  for (const t of teams) upsertTeam.run(t);
  const changed = applyFixtures(fixtures);
  for (const id of changed) recalcMatch(id);
  if (standingGroups.length) applyStandings(standingGroups);
  return {
    provider: provider.name,
    teams: teams.length,
    fixtures: fixtures.length,
    changed: changed.length,
    standingGroups: standingGroups.length,
  };
}

// Quick sync — only recent dates + standings (used by live-agent every 2 min)
async function quickSync() {
  const provider = getProvider();
  const fetchRecent = typeof provider.fetchRecentFixtures === 'function'
    ? provider.fetchRecentFixtures
    : provider.fetchFixtures;
  const [fixtures, standingGroups] = await Promise.all([
    fetchRecent.call(provider),
    typeof provider.fetchStandings === 'function' ? provider.fetchStandings() : Promise.resolve([]),
  ]);
  // If real provider data came back, evict placeholder seeds to prevent duplicates
  if (fixtures.length > 0) {
    db.prepare("DELETE FROM matches WHERE ext_id LIKE 'seed-%'").run();
  }
  const changed = applyFixtures(fixtures);
  for (const id of changed) recalcMatch(id);
  if (standingGroups.length) applyStandings(standingGroups);

  // Fetch goalscorers for live matches and recently changed matches
  if (typeof provider.fetchMatchSummary === 'function') {
    const targets = db.prepare(
      "SELECT id, ext_id FROM matches WHERE status = 'live' OR (status = 'finished' AND id IN (" +
      (changed.length ? changed.map(() => '?').join(',') : 'SELECT 0') + "))"
    ).all(...changed);
    await Promise.all(targets.map(async (m) => {
      if (!m.ext_id?.startsWith('espn-')) return;
      const goals = await provider.fetchMatchSummary(m.ext_id.replace('espn-', ''));
      if (goals !== null) {
        db.prepare("UPDATE matches SET goals_json = ? WHERE id = ?").run(JSON.stringify(goals), m.id);
      }
    }));
  }

  return { provider: provider.name, fixtures: fixtures.length, changed: changed.length };
}

function seedIfEmpty() {
  const teamCount = db.prepare('SELECT COUNT(*) AS c FROM teams').get().c;
  if (teamCount === 0) {
    for (const t of seed.TEAMS) upsertTeam.run({ extId: null, ...t });
  }
  const matchCount = db.prepare('SELECT COUNT(*) AS c FROM matches').get().c;
  if (matchCount === 0) {
    applyFixtures(seed.buildFixtures());
    console.log('Seeded placeholder fixtures. Use Admin → Sync to load real data.');
  }
}

// Flip upcoming→live at kickoff even without API polling.
function refreshStatuses() {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE matches SET status = 'live', updated_at = datetime('now')
    WHERE status = 'upcoming' AND kickoff <= ?
  `).run(now);
}

module.exports = { syncFromProvider, quickSync, seedIfEmpty, refreshStatuses };
