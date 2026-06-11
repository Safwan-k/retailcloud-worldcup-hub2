require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const routes = require('./src/routes');
const db = require('./src/db');
const { seedIfEmpty, syncFromProvider, refreshStatuses } = require('./src/sports/sync');
const liveAgent = require('./src/sports/liveAgent');

const app = express();
app.use(express.json());
app.use(cookieParser());

app.use('/api', routes);
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

seedIfEmpty();
// Immediately remove seed placeholders so ESPN data loads clean (no duplicates)
db.prepare("DELETE FROM matches WHERE ext_id LIKE 'seed-%'").run();
refreshStatuses();
// Auto-sync all fixtures from ESPN on startup (async, non-blocking)
syncFromProvider().then(r => {
  console.log(`[startup] synced ${r.fixtures} fixtures from ${r.provider}`);
}).catch(err => console.warn('[startup] sync failed:', err.message));

// Live agent: adaptive background sync (fast while matches are live, slow when idle).
// Disable with LIVE_AGENT=off (then sync is manual via Admin panel only).
if ((process.env.LIVE_AGENT || 'on').toLowerCase() !== 'off') {
  liveAgent.start();
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Retailcloud World Cup Hub running on http://localhost:${PORT}`);
  if (!process.env.GOOGLE_CLIENT_ID) {
    console.warn('WARNING: GOOGLE_CLIENT_ID not set — Google Sign-In will not work. See .env');
  }
});
