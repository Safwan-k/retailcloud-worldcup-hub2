const db = require('./db');

const POINTS_CORRECT_OUTCOME = 3;
const POINTS_EXACT_BONUS = 5;

function outcome(scoreA, scoreB) {
  if (scoreA > scoreB) return 'A';
  if (scoreA < scoreB) return 'B';
  return 'D';
}

function scorePrediction(pred, match) {
  if (match.status !== 'finished' || match.score_a == null || match.score_b == null) return null;
  let pts = 0;
  if (pred.winner === outcome(match.score_a, match.score_b)) pts += POINTS_CORRECT_OUTCOME;
  if (pred.score_a === match.score_a && pred.score_b === match.score_b) pts += POINTS_EXACT_BONUS;
  return pts;
}

// Recompute points for one match's predictions, then refresh affected totals.
const recalcMatch = db.transaction((matchId) => {
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return;
  const preds = db.prepare('SELECT * FROM predictions WHERE match_id = ?').all(matchId);
  const upd = db.prepare(`UPDATE predictions SET points = ?, updated_at = datetime('now') WHERE id = ?`);
  for (const p of preds) upd.run(scorePrediction(p, match), p.id);
  refreshTotals();
});

// Recompute everything from scratch (admin "recalculate points").
const recalcAll = db.transaction(() => {
  const matches = db.prepare('SELECT * FROM matches').all();
  const byId = new Map(matches.map(m => [m.id, m]));
  const preds = db.prepare('SELECT * FROM predictions').all();
  const upd = db.prepare(`UPDATE predictions SET points = ?, updated_at = datetime('now') WHERE id = ?`);
  for (const p of preds) upd.run(scorePrediction(p, byId.get(p.match_id)), p.id);
  refreshTotals();
});

function refreshTotals() {
  db.prepare(`
    UPDATE employees SET total_points = COALESCE(
      (SELECT SUM(points) FROM predictions WHERE employee_id = employees.id AND points IS NOT NULL), 0
    ), updated_at = datetime('now')
  `).run();
}

// Admin "reset leaderboard": wipe scored points (predictions stay, points cleared).
const resetLeaderboard = db.transaction(() => {
  db.prepare('UPDATE predictions SET points = NULL').run();
  db.prepare('UPDATE employees SET total_points = 0').run();
});

module.exports = { recalcMatch, recalcAll, resetLeaderboard, POINTS_CORRECT_OUTCOME, POINTS_EXACT_BONUS };
