const express = require('express');
const db = require('./db');
const { googleLogin, logout, requireAuth, requireAdmin, publicEmployee } = require('./auth');
const { recalcMatch, recalcAll, resetLeaderboard } = require('./points');
const { syncFromProvider, refreshStatuses } = require('./sports/sync');
const liveAgent = require('./sports/liveAgent');

const router = express.Router();

// ---------- Public ----------
router.get('/config', (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
});
router.post('/auth/google', googleLogin);
router.post('/auth/logout', logout);

// Everything below requires a valid session + allowlist membership.
router.use(requireAuth);

// ---------- Profile ----------
router.get('/me', (req, res) => res.json({ employee: publicEmployee(req.employee) }));

router.patch('/me', (req, res) => {
  const { favoriteTeamId, department, location } = req.body || {};
  if (favoriteTeamId != null) {
    const team = db.prepare('SELECT id FROM teams WHERE id = ?').get(favoriteTeamId);
    if (!team) return res.status(400).json({ error: 'Unknown team.' });
    db.prepare(`UPDATE employees SET favorite_team_id = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(favoriteTeamId, req.employee.id);
  }
  if (department !== undefined) {
    db.prepare(`UPDATE employees SET department = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(department || null, req.employee.id);
  }
  if (location !== undefined) {
    db.prepare(`UPDATE employees SET location = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(location || null, req.employee.id);
  }
  const fresh = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.employee.id);
  res.json({ employee: publicEmployee(fresh) });
});

// ---------- Teams ----------
router.get('/teams', (req, res) => {
  const teams = db.prepare(`
    SELECT t.*, (SELECT COUNT(*) FROM employees e WHERE e.favorite_team_id = t.id) AS supporters
    FROM teams t
    WHERE t.ext_id LIKE 'espn-team-%'
    ORDER BY t.group_name, t.name
  `).all();
  res.json({ teams });
});

router.get('/teams/:id/supporters', (req, res) => {
  const supporters = db.prepare(`
    SELECT name, department, profile_picture AS profilePicture, total_points AS totalPoints
    FROM employees WHERE favorite_team_id = ? ORDER BY total_points DESC, name
  `).all(req.params.id);
  res.json({ supporters });
});

// ---------- Matches ----------
const MATCH_SELECT = `
  SELECT m.id, m.ext_id, m.kickoff, m.stage, m.group_name AS groupName, m.status,
         m.score_a AS scoreA, m.score_b AS scoreB,
         m.prediction_override AS predictionOverride,
         m.goals_json AS goalsJson,
         ta.id AS teamAId, ta.name AS teamAName, ta.flag AS teamAFlag, ta.code AS teamACode,
         tb.id AS teamBId, tb.name AS teamBName, tb.flag AS teamBFlag, tb.code AS teamBCode
  FROM matches m
  JOIN teams ta ON ta.id = m.team_a_id
  JOIN teams tb ON tb.id = m.team_b_id
`;

router.get('/matches', (req, res) => {
  refreshStatuses();
  const matches = db.prepare(`${MATCH_SELECT} ORDER BY m.kickoff`).all();
  const mine = db.prepare('SELECT * FROM predictions WHERE employee_id = ?').all(req.employee.id);
  const predByMatch = Object.fromEntries(mine.map(p => [p.match_id, p]));
  res.json({
    matches: matches.map(m => ({
      ...m,
      locked: !m.predictionOverride && (m.status !== 'upcoming' || new Date(m.kickoff) <= new Date()),
      myPrediction: predByMatch[m.id]
        ? { winner: predByMatch[m.id].winner, scoreA: predByMatch[m.id].score_a, scoreB: predByMatch[m.id].score_b, points: predByMatch[m.id].points }
        : null,
    })),
  });
});

// ---------- Predictions ----------
router.post('/predictions', (req, res) => {
  const { matchId, winner, scoreA, scoreB } = req.body || {};
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found.' });

  // Server-side lock. Lock 5 min before kickoff; live until ~halftime (45 min after kickoff).
  refreshStatuses();
  const fresh = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  const kickoff = new Date(fresh.kickoff).getTime();
  const locked = !fresh.prediction_override && (
    fresh.status === 'finished' ||
    (fresh.status === 'live' && Date.now() - kickoff > 45 * 60 * 1000) ||
    (fresh.status === 'upcoming' && kickoff - Date.now() <= 5 * 60 * 1000)
  );
  if (locked) {
    return res.status(403).json({ error: 'Predictions locked — closes 5 min before kickoff (live until halftime).' });
  }

  const a = Number(scoreA), b = Number(scoreB);
  if (!['A', 'D', 'B'].includes(winner)) return res.status(400).json({ error: 'Invalid winner.' });
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a > 20 || b > 20) {
    return res.status(400).json({ error: 'Scores must be whole numbers between 0 and 20.' });
  }
  const impliedWinner = a > b ? 'A' : a < b ? 'B' : 'D';
  if (impliedWinner !== winner) {
    return res.status(400).json({ error: 'Predicted score does not match the predicted winner.' });
  }

  db.prepare(`
    INSERT INTO predictions (employee_id, match_id, winner, score_a, score_b)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(employee_id, match_id) DO UPDATE SET
      winner = excluded.winner, score_a = excluded.score_a, score_b = excluded.score_b,
      updated_at = datetime('now')
  `).run(req.employee.id, matchId, winner, a, b);
  res.json({ ok: true });
});

router.get('/predictions/mine', (req, res) => {
  const rows = db.prepare(`
    SELECT p.match_id AS matchId, p.winner, p.score_a AS scoreA, p.score_b AS scoreB, p.points
    FROM predictions p WHERE p.employee_id = ?
  `).all(req.employee.id);
  res.json({ predictions: rows });
});

// ---------- Standings ----------
router.get('/standings', (req, res) => {
  const rows = db.prepare(`
    SELECT group_name AS groupName, team_name AS teamName, team_code AS teamCode,
           team_flag AS teamFlag, played, won, drawn, lost,
           goals_for AS goalsFor, goals_against AS goalsAgainst,
           goal_diff AS goalDiff, points, position, updated_at AS updatedAt
    FROM standings
    ORDER BY groupName, position, points DESC, goal_diff DESC, goals_for DESC, teamName
  `).all();

  // Group into { groupName: rows[] }
  const groups = {};
  for (const r of rows) {
    if (!groups[r.groupName]) groups[r.groupName] = [];
    groups[r.groupName].push(r);
  }
  const updatedAt = rows[0]?.updatedAt || null;
  res.json({ groups, updatedAt });
});

// ---------- Leaderboards ----------
router.get('/leaderboard', (req, res) => {
  const type = req.query.type || 'overall';
  const base = `
    SELECT e.id, e.name, e.department, e.profile_picture AS profilePicture,
           e.total_points AS totalPoints, e.favorite_team_id AS favoriteTeamId,
           t.name AS favoriteTeamName, t.flag AS favoriteTeamFlag
    FROM employees e LEFT JOIN teams t ON t.id = e.favorite_team_id
  `;
  if (type === 'department') {
    const rows = db.prepare(`
      SELECT COALESCE(e.department, 'Unassigned') AS department,
             COUNT(*) AS members, SUM(e.total_points) AS totalPoints,
             ROUND(AVG(e.total_points), 1) AS avgPoints
      FROM employees e GROUP BY COALESCE(e.department, 'Unassigned')
      ORDER BY totalPoints DESC
    `).all();
    return res.json({ type, rows });
  }
  if (type === 'team') {
    const teamId = Number(req.query.teamId) || req.employee.favorite_team_id;
    const rows = teamId
      ? db.prepare(`${base} WHERE e.favorite_team_id = ? ORDER BY e.total_points DESC, e.name`).all(teamId)
      : [];
    return res.json({ type, teamId, rows });
  }
  const rows = db.prepare(`${base} ORDER BY e.total_points DESC, e.name`).all();
  res.json({ type: 'overall', rows });
});

// ---------- Home feed ----------
router.get('/feed', (req, res) => {
  refreshStatuses();
  const live = db.prepare(`${MATCH_SELECT} WHERE m.status = 'live' ORDER BY m.kickoff`).all();
  const liveIds = new Set(live.map(m => m.id));
  // today = upcoming matches today only (live ones already shown in live section)
  // Use client's local date (passed as ?date=YYYY-MM-DD) to handle timezone offsets
  const todayStr = req.query.date || new Date().toISOString().slice(0, 10);
  const today = db.prepare(`${MATCH_SELECT}
    WHERE m.status = 'upcoming'
    AND substr(m.kickoff, 1, 10) = ?
    ORDER BY m.kickoff`).all(todayStr).filter(m => !liveIds.has(m.id));
  const finished = db.prepare(`${MATCH_SELECT} WHERE m.status = 'finished' ORDER BY m.kickoff DESC LIMIT 6`).all();
  const top5 = db.prepare(`
    SELECT e.name, e.department, e.total_points AS totalPoints, t.flag AS favoriteTeamFlag
    FROM employees e LEFT JOIN teams t ON t.id = e.favorite_team_id
    ORDER BY e.total_points DESC, e.name LIMIT 5
  `).all();

  // Favorite team journey card
  let journey = null;
  if (req.employee.favorite_team_id) {
    const team = db.prepare(`
      SELECT t.*, (SELECT COUNT(*) FROM employees e WHERE e.favorite_team_id = t.id) AS supporters
      FROM teams t WHERE t.id = ?
    `).get(req.employee.favorite_team_id);
    const next = db.prepare(`${MATCH_SELECT}
      WHERE (m.team_a_id = ? OR m.team_b_id = ?) AND m.status = 'upcoming' ORDER BY m.kickoff LIMIT 1
    `).get(team.id, team.id);
    const last = db.prepare(`${MATCH_SELECT}
      WHERE (m.team_a_id = ? OR m.team_b_id = ?) AND m.status = 'finished' ORDER BY m.kickoff DESC LIMIT 1
    `).get(team.id, team.id);
    journey = { team, nextMatch: next || null, lastMatch: last || null };
  }

  // Simple generated "news" from recent results + upcoming highlights.
  const news = [
    ...finished.slice(0, 3).map(m => ({
      title: `FT: ${m.teamAName} ${m.scoreA} – ${m.scoreB} ${m.teamBName}`,
      tag: 'Result',
    })),
    ...live.map(m => ({ title: `LIVE: ${m.teamAName} vs ${m.teamBName}`, tag: 'Live' })),
    ...today.filter(m => m.status === 'upcoming').slice(0, 3).map(m => ({
      title: `Today: ${m.teamAName} vs ${m.teamBName} at ${new Date(m.kickoff).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      tag: 'Upcoming',
    })),
  ];

  res.json({ today, live, finished, top5, journey, news });
});

// ---------- Admin ----------
router.use('/admin', requireAdmin);

router.get('/admin/agent', (req, res) => {
  res.json({ agent: liveAgent.status() });
});

router.post('/admin/sync', async (req, res) => {
  try {
    const result = await syncFromProvider();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(502).json({ error: `Sync failed: ${err.message}` });
  }
});

router.get('/admin/employees', (req, res) => {
  const rows = db.prepare(`
    SELECT e.id, e.name, e.email, e.department, e.location, e.total_points AS totalPoints,
           e.created_at AS createdAt, t.name AS favoriteTeamName
    FROM employees e LEFT JOIN teams t ON t.id = e.favorite_team_id ORDER BY e.name
  `).all();
  res.json({ employees: rows });
});

router.get('/admin/predictions', (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, e.name AS employee, ta.name AS teamA, tb.name AS teamB,
           p.winner, p.score_a AS scoreA, p.score_b AS scoreB, p.points, m.status, m.kickoff
    FROM predictions p
    JOIN employees e ON e.id = p.employee_id
    JOIN matches m ON m.id = p.match_id
    JOIN teams ta ON ta.id = m.team_a_id
    JOIN teams tb ON tb.id = m.team_b_id
    ORDER BY m.kickoff DESC, e.name
  `).all();
  res.json({ predictions: rows });
});

router.post('/admin/matches/:id/result', (req, res) => {
  const { scoreA, scoreB, status } = req.body || {};
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found.' });
  const a = Number(scoreA), b = Number(scoreB);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
    return res.status(400).json({ error: 'Invalid scores.' });
  }
  const st = ['upcoming', 'live', 'finished'].includes(status) ? status : 'finished';
  db.prepare(`UPDATE matches SET score_a = ?, score_b = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(a, b, st, match.id);
  recalcMatch(match.id);
  res.json({ ok: true });
});

router.post('/admin/matches/:id/unlock', (req, res) => {
  const { unlock } = req.body || {};
  const match = db.prepare('SELECT id FROM matches WHERE id = ?').get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found.' });
  db.prepare(`UPDATE matches SET prediction_override = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(unlock ? 1 : 0, match.id);
  res.json({ ok: true });
});

router.post('/admin/recalculate', (req, res) => {
  recalcAll();
  res.json({ ok: true });
});

router.post('/admin/reset-leaderboard', (req, res) => {
  resetLeaderboard();
  res.json({ ok: true });
});

module.exports = router;
