/**
 * Live sync agent — keeps scores/status/standings fresh every 2 minutes.
 *
 * Uses quickSync (recent dates only) to be efficient — full syncFromProvider
 * is only triggered by Admin → "Sync matches" or on first boot.
 */
const db = require('../db');
const { quickSync, refreshStatuses } = require('./sync');

// Always poll every 2 minutes regardless of live/idle state.
const POLL_MS = Number(process.env.POLL_INTERVAL_MS || 2 * 60 * 1000);

let timer = null;
let lastResult = { at: null, ok: null, detail: 'not started' };

async function tick() {
  refreshStatuses();
  try {
    const r = await quickSync();
    lastResult = {
      at: new Date().toISOString(),
      ok: true,
      detail: `${r.fixtures} fixtures checked, ${r.changed} results updated (${r.provider})`,
    };
    if (r.changed > 0) console.log(`[live-agent] ${lastResult.detail}`);
  } catch (err) {
    lastResult = { at: new Date().toISOString(), ok: false, detail: err.message };
    console.error(`[live-agent] sync failed: ${err.message}`);
  }
  schedule();
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(tick, POLL_MS);
  timer.unref?.();
}

function start() {
  console.log(`[live-agent] started — polling every ${POLL_MS / 1000}s via ESPN`);
  tick();
}

function status() {
  return {
    running: timer !== null,
    mode: 'always',
    pollIntervalSeconds: POLL_MS / 1000,
    // Legacy field names kept so admin panel still works
    livePollSeconds: POLL_MS / 1000,
    idlePollMinutes: POLL_MS / 60000,
    lastSync: lastResult,
  };
}

module.exports = { start, status };
