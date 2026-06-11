const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { isAllowedEmployee, isAdmin, employeeName } = require('./allowlist');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const SESSION_COOKIE = 'rc_session';
const ACCESS_DENIED_MESSAGE =
  'Access restricted. Your email is not registered for the Retailcloud World Cup Hub.';

const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Verify Google ID token server-side, enforce allowlist, upsert employee, issue session.
async function googleLogin(req, res) {
  try {
    const { credential } = req.body || {};
    if (!credential) return res.status(400).json({ error: 'Missing Google credential.' });

    const ticket = await oauthClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const email = String(payload.email || '').toLowerCase();

    if (!payload.email_verified || !isAllowedEmployee(email)) {
      return res.status(403).json({ error: ACCESS_DENIED_MESSAGE });
    }

    const name = payload.name || employeeName(email) || email;
    const picture = payload.picture || null;
    const googleId = payload.sub;

    const existing = db.prepare('SELECT * FROM employees WHERE email = ?').get(email);
    let employee;
    if (existing) {
      db.prepare(
        `UPDATE employees SET google_id = ?, name = ?, profile_picture = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(googleId, name, picture, existing.id);
      employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(existing.id);
    } else {
      const info = db.prepare(
        `INSERT INTO employees (google_id, name, email, profile_picture) VALUES (?, ?, ?, ?)`
      ).run(googleId, name, email, picture);
      employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(info.lastInsertRowid);
    }

    const token = jwt.sign({ sub: employee.id, email }, JWT_SECRET, { expiresIn: '30d' });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    res.json({ employee: publicEmployee(employee) });
  } catch (err) {
    console.error('Google login failed:', err.message);
    res.status(401).json({ error: 'Google sign-in verification failed. Please try again.' });
  }
}

function logout(req, res) {
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
}

// All API routes go through this. Allowlist re-checked on every request so
// removing someone from config locks them out immediately.
function requireAuth(req, res, next) {
  try {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return res.status(401).json({ error: 'Not signed in.' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(decoded.sub);
    if (!employee || !isAllowedEmployee(employee.email)) {
      return res.status(403).json({ error: ACCESS_DENIED_MESSAGE });
    }
    req.employee = employee;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.employee || !isAdmin(req.employee.email)) {
    return res.status(403).json({ error: 'Admin access only.' });
  }
  next();
}

function publicEmployee(e) {
  return {
    id: e.id,
    name: e.name,
    email: e.email,
    profilePicture: e.profile_picture,
    department: e.department,
    location: e.location,
    favoriteTeamId: e.favorite_team_id,
    totalPoints: e.total_points,
    isAdmin: isAdmin(e.email),
    createdAt: e.created_at,
    updatedAt: e.updated_at,
  };
}

module.exports = { googleLogin, logout, requireAuth, requireAdmin, publicEmployee };
