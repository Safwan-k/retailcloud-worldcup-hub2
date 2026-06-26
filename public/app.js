/* Retailcloud World Cup Hub — SPA */
(() => {
  const $ = (sel) => document.querySelector(sel);
  let me = null;
  let teamsCache = null;
  let pollTimer = null;

  // ---------- API helper ----------
  async function api(path, opts = {}) {
    const res = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function toast(msg, isErr = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `toast${isErr ? ' err' : ''}`;
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  // Lock 5 min before kickoff, for all live and finished matches
  // predictionOverride = admin can force-unlock any match
  function isMatchLocked(m) {
    if (m.predictionOverride) return false;
    if (m.status === 'finished' || m.status === 'live') return true;
    const kickoff = new Date(m.kickoff).getTime();
    return kickoff - Date.now() <= 5 * 60 * 1000;
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function flagHtml(flag, fallback = '') {
    if (!flag) return fallback;
    if (/^https?:/.test(flag)) return `<img src="${esc(flag)}" alt="" loading="lazy">`;
    return esc(flag);
  }

  const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const fmtDate = (iso) => new Date(iso).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });

  // ---------- View switching ----------
  const VIEWS = ['login', 'pickteam', 'home', 'matches', 'leaderboard', 'supporters', 'profile', 'admin'];
  function show(view) {
    VIEWS.forEach(v => $(`#view-${v}`)?.classList.toggle('hidden', v !== view));
    const inShell = !['login', 'pickteam'].includes(view);
    $('#shell').classList.toggle('hidden', !inShell);
    $('#view-login').classList.toggle('hidden', view !== 'login');
    $('#view-pickteam').classList.toggle('hidden', view !== 'pickteam');
    // highlight nav — profile/admin live in popover, not bottomnav
    document.querySelectorAll('.bottomnav a').forEach(a =>
      a.classList.toggle('active', a.dataset.nav === view));
  }

  function route() {
    if (!me) { show('login'); return; }
    if (!me.favoriteTeamId) { renderPickTeam(); return; }
    const hash = location.hash.replace('#', '') || 'home';
    const view = VIEWS.includes(hash) ? hash : 'home';
    if (view === 'admin' && !me.isAdmin) { location.hash = '#home'; return; }
    show(view);
    return ({ home: renderHome, matches: renderMatches, leaderboard: renderLeaderboard,
       supporters: renderSupporters, profile: renderProfile, admin: renderAdmin }[view])();
  }
  window.addEventListener('hashchange', route);

  // ---------- Auth ----------
  async function init() {
    const cfg = await api('/config').catch(() => ({ googleClientId: '' }));
    try {
      const { employee } = await api('/me');
      me = employee;
    } catch { me = null; }

    if (!me) {
      show('login');
      initGoogleButton(cfg.googleClientId);
    } else {
      updateTopbar();
      route();
    }
  }

  function initGoogleButton(clientId) {
    if (!clientId) {
      $('#loginError').textContent = 'Server is missing GOOGLE_CLIENT_ID — ask the admin to configure it.';
      $('#loginError').classList.remove('hidden');
      return;
    }
    const tryInit = () => {
      if (!window.google?.accounts?.id) { setTimeout(tryInit, 150); return; }
      google.accounts.id.initialize({ client_id: clientId, callback: onGoogleCredential });
      google.accounts.id.renderButton($('#googleBtn'), {
        theme: 'filled_blue', size: 'large', text: 'signin_with', shape: 'pill', width: 280,
      });
    };
    tryInit();
  }

  async function onGoogleCredential(response) {
    try {
      const { employee } = await api('/auth/google', { method: 'POST', body: { credential: response.credential } });
      me = employee;
      $('#loginError').classList.add('hidden');
      updateTopbar();
      location.hash = '#home';
      route();
    } catch (err) {
      $('#loginError').textContent = err.message;
      $('#loginError').classList.remove('hidden');
    }
  }

  function updateTopbar() {
    $('#myPoints').textContent = `${me.totalPoints} pts`;
    $('#myAvatar').src = me.profilePicture || avatarFallback(me.name);
    $('#menuAdmin').classList.toggle('hidden', !me.isAdmin);
  }

  const avatarFallback = (name) =>
    `https://ui-avatars.com/api/?background=0b2e59&color=fff&name=${encodeURIComponent(name || '?')}`;

  async function refreshMe() {
    const { employee } = await api('/me');
    me = employee;
    updateTopbar();
  }

  // ---------- Pick team ----------
  async function renderPickTeam() {
    show('pickteam');
    // Show back button only when user already has a team (change-team flow)
    $('#pickBack').classList.toggle('hidden', !me?.favoriteTeamId);
    $('#pickBack').onclick = () => { location.hash = '#home'; route(); };
    const { teams } = await api('/teams');
    teamsCache = teams;
    $('#teamGrid').innerHTML = teams.map(t => `
      <button class="team-tile" data-id="${t.id}">
        <span class="flag">${flagHtml(t.flag)}</span>
        <div class="tname">${esc(t.name)}</div>
        <div class="sup">${t.supporters} fan${t.supporters === 1 ? '' : 's'}</div>
      </button>
    `).join('');
    $('#teamGrid').querySelectorAll('.team-tile').forEach(btn => {
      btn.onclick = async () => {
        btn.classList.add('selected');
        try {
          await api('/me', { method: 'PATCH', body: {
            favoriteTeamId: Number(btn.dataset.id),
            location: $('#pickLocation').value || undefined,
          }});
          await refreshMe();
          toast('Team locked in!');
          location.hash = '#home';
          route();
        } catch (e) { toast(e.message, true); }
      };
    });
  }

  // ---------- Match card ----------
  function matchCard(m, { withActions = true } = {}) {
    const statusBadge = `<span class="status-badge status-${m.status}">${
      m.status === 'live' ? 'Live' : m.status === 'finished' ? 'Full time' : fmtTime(m.kickoff)}</span>`;
    // Score only renders for live/finished matches — upcoming always shows VS + kickoff.
    const penaltyHtml = m.penaltyA != null ? `<div class="penalty-score">pens ${m.penaltyA}–${m.penaltyB}</div>` : '';
    const center = m.status === 'upcoming'
      ? `<div class="vs">VS</div><div class="kick">${fmtTime(m.kickoff)}</div>`
      : `<div class="score"><span>${m.scoreA ?? 0}</span><span class="score-sep">–</span><span>${m.scoreB ?? 0}</span></div>${penaltyHtml}`;

    // Goalscorers row
    let scorersHtml = '';
    if (m.status !== 'upcoming' && m.goalsJson) {
      try {
        const goals = JSON.parse(m.goalsJson);
        if (goals.length) {
          const a = goals.filter(g => g.side === 'A').map(g => `${esc(g.player)} ${esc(g.minute)}`).join(', ');
          const b = goals.filter(g => g.side === 'B').map(g => `${esc(g.player)} ${esc(g.minute)}`).join(', ');
          scorersHtml = `<div class="scorers-row"><span class="scorers-side">${a}</span><span class="scorers-side scorers-right">${b}</span></div>`;
        }
      } catch {}
    }

    let actions = '';
    if (withActions) {
      const p = m.myPrediction;
      const predTxt = p
        ? `Your pick: <b>${p.scoreA}–${p.scoreB}</b>${p.points != null ? ` · <span class="pred-points">+${p.points} pts</span>` : ''}`
        : (m.locked ? 'No prediction' : 'No prediction yet');
      const btn = !m.locked
        ? `<button class="btn small ${p ? 'ghost' : 'orange'}" data-predict="${m.id}">${p
            ? '<ion-icon name="pencil"></ion-icon> Edit pick'
            : '<ion-icon name="football"></ion-icon> Predict'}</button>`
        : `<button class="btn small ghost" disabled><ion-icon name="lock-closed"></ion-icon> Locked</button>`;
      const breakdownBtn = m.status === 'finished'
        ? `<button class="btn small ghost" data-breakdown="${m.id}"><ion-icon name="people"></ion-icon> Predictions</button>`
        : '';
      actions = `<div class="match-actions"><span class="mypred">${predTxt}</span>${btn}${breakdownBtn}</div>`;
    }
    return `
      <div class="match-card" data-match="${m.id}">
        <div class="match-hero">
          <div class="match-meta">
            <span>${esc(m.stage)}${m.groupName ? ` · Group ${esc(m.groupName)}` : ''}</span>
            ${statusBadge}
          </div>
          <div class="match-row">
            <div class="team"><span class="flag">${flagHtml(m.teamAFlag)}</span><span class="tname">${esc(m.teamAName)}</span></div>
            <div class="match-center">${center}</div>
            <div class="team"><span class="flag">${flagHtml(m.teamBFlag)}</span><span class="tname">${esc(m.teamBName)}</span></div>
          </div>
          ${scorersHtml}
        </div>
        ${actions}
      </div>`;
  }

  function bindPredictButtons(container, matches) {
    container.querySelectorAll('[data-predict]').forEach(btn => {
      btn.onclick = () => openPredictionModal(matches.find(m => m.id === Number(btn.dataset.predict)));
    });
    container.querySelectorAll('[data-breakdown]').forEach(btn => {
      btn.onclick = () => openBreakdownModal(matches.find(m => m.id === Number(btn.dataset.breakdown)));
    });
  }

  async function openBreakdownModal(m) {
    const modal = $('#modal');
    const inner = $('#modalCard');
    inner.innerHTML = `<div class="modal-header"><h2>${esc(m.teamAName)} vs ${esc(m.teamBName)}</h2><p class="modal-note">Final score: ${m.scoreA}–${m.scoreB}</p><button class="modal-close" id="breakdownClose" aria-label="Close">✕</button></div><div class="modal-body"><p>Loading…</p></div>`;
    modal.classList.remove('hidden');
    $('#breakdownClose').onclick = () => modal.classList.add('hidden');
    try {
      const { rows } = await api(`/matches/${m.id}/breakdown`);
      if (!rows.length) { inner.querySelector('p:last-child').textContent = 'No predictions made.'; return; }
      const actualOutcome = m.scoreA > m.scoreB ? 'A' : m.scoreA < m.scoreB ? 'B' :
        (m.penaltyA != null ? (m.penaltyA > m.penaltyB ? 'A' : 'B') : 'D');
      const rows_html = rows.map(r => {
        const correct = r.winner === actualOutcome ? '✓' : '✗';
        const pts = r.points != null ? `<span class="pred-points">+${r.points}</span>` : '—';
        const avatar = r.profile_picture
          ? `<img src="${esc(r.profile_picture)}" class="av-sm">`
          : `<span class="av-sm av-fallback">${esc(r.name[0])}</span>`;
        return `<tr><td>${avatar} ${esc(r.name)}</td><td>${r.score_a}–${r.score_b}</td><td class="${r.winner === actualOutcome ? 'correct' : 'wrong'}">${correct}</td><td>${pts}</td></tr>`;
      }).join('');
      inner.innerHTML = `
        <div class="modal-header">
          <h2>${esc(m.teamAName)} vs ${esc(m.teamBName)}</h2>
          <p class="modal-note">Final score: ${m.scoreA}–${m.scoreB} · ${rows.length} predictions</p>
          <button class="modal-close" id="breakdownClose" aria-label="Close">✕</button>
        </div>
        <div class="modal-body">
          <table class="breakdown-table">
            <thead><tr><th>Player</th><th>Pick</th><th>Result</th><th>Pts</th></tr></thead>
            <tbody>${rows_html}</tbody>
          </table>
        </div>`;
      $('#breakdownClose').onclick = () => modal.classList.add('hidden');
    } catch (e) { inner.querySelector('p:last-child').textContent = 'Failed to load.'; }
  }

  // ---------- Prediction modal ----------
  function openPredictionModal(m) {
    const p = m.myPrediction;
    $('#modalCard').innerHTML = `<div class="modal-body" style="padding-top:20px">
      <h3>Your prediction</h3>
      <div class="match-row" style="margin-bottom:16px">
        <div class="team"><span class="flag">${flagHtml(m.teamAFlag)}</span><span class="tname">${esc(m.teamAName)}</span></div>
        <div class="match-center"><div class="vs">VS</div><div class="kick">${fmtDate(m.kickoff)} · ${fmtTime(m.kickoff)}</div></div>
        <div class="team"><span class="flag">${flagHtml(m.teamBFlag)}</span><span class="tname">${esc(m.teamBName)}</span></div>
      </div>
      <div class="winner-opts">
        <button class="winner-opt" data-w="A"><span class="flag">${flagHtml(m.teamAFlag)}</span>${esc(m.teamAName)}</button>
        ${m.stage === 'Group Stage' ? `<button class="winner-opt" data-w="D"><span class="flag"><ion-icon name="remove" class="draw-mark"></ion-icon></span>Draw</button>` : ''}
        <button class="winner-opt" data-w="B"><span class="flag">${flagHtml(m.teamBFlag)}</span>${esc(m.teamBName)}</button>
      </div>
      <div class="score-inputs">
        <input id="predA" type="number" min="0" max="20" inputmode="numeric" value="${p ? p.scoreA : ''}" placeholder="0">
        <span class="dash">–</span>
        <input id="predB" type="number" min="0" max="20" inputmode="numeric" value="${p ? p.scoreB : ''}" placeholder="0">
      </div>
      <p class="modal-note">
        ${m.stage === 'Group Stage' ? 'Right result: <b>3 pts</b> · Nail the exact score: <b>8 pts</b>' : 'Knockout: pick the winner (even for tied score — penalties decide). Right winner: <b>3 pts</b> · Exact score: <b>8 pts</b>'}
      </p>
      <div class="modal-actions">
        <button class="btn ghost" id="predCancel">Cancel</button>
        <button class="btn orange" id="predSave">Save prediction</button>
      </div>
    </div>`;
    $('#modal').classList.remove('hidden');

    let winner = p?.winner || null;
    const opts = $('#modalCard').querySelectorAll('.winner-opt');
    const paint = () => opts.forEach(o => o.classList.toggle('selected', o.dataset.w === winner));
    paint();
    opts.forEach(o => o.onclick = () => { winner = o.dataset.w; syncScoreFromWinner(); paint(); });

    // Keep winner and score consistent both directions.
    function syncScoreFromWinner() {
      const a = $('#predA'), b = $('#predB');
      const av = Number(a.value), bv = Number(b.value);
      if (a.value === '' || b.value === '') return;
      if (winner === 'A' && av <= bv) a.value = bv + 1;
      if (winner === 'B' && bv <= av) b.value = av + 1;
      if (winner === 'D' && m.stage === 'Group Stage') b.value = a.value;
    }
    function syncWinnerFromScore() {
      const av = Number($('#predA').value), bv = Number($('#predB').value);
      if ($('#predA').value === '' || $('#predB').value === '') return;
      if (av === bv && m.stage !== 'Group Stage') return; // knockout tied: keep current winner
      winner = av > bv ? 'A' : av < bv ? 'B' : 'D';
      paint();
    }
    $('#predA').oninput = syncWinnerFromScore;
    $('#predB').oninput = syncWinnerFromScore;

    $('#predCancel').onclick = closeModal;
    $('#predSave').onclick = async () => {
      const a = $('#predA').value, b = $('#predB').value;
      if (!winner || a === '' || b === '') { toast('Pick a winner and enter a score.', true); return; }
      try {
        await api('/predictions', { method: 'POST', body: { matchId: m.id, winner, scoreA: Number(a), scoreB: Number(b) } });
        closeModal();
        toast('Prediction saved');
        const scrollY = window.scrollY;
        await route();
        window.scrollTo({ top: scrollY, behavior: 'instant' });
      } catch (e) { toast(e.message, true); }
    };
  }
  function closeModal() { $('#modal').classList.add('hidden'); }
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

  // ---------- Avatar menu (topbar) ----------
  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    me = null; location.hash = ''; location.reload();
  }
  $('#avatarBtn').onclick = (e) => {
    e.stopPropagation();
    $('#avatarMenu').classList.toggle('hidden');
  };
  $('#menuLogout').onclick = logout;
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.avatar-wrap')) $('#avatarMenu').classList.add('hidden');
  });
  $('#avatarMenu').querySelectorAll('[data-menu]').forEach(el =>
    el.addEventListener('click', () => $('#avatarMenu').classList.add('hidden')));

  // ---------- Home ----------
  async function renderHome() {
    const el = $('#view-home');
    const localDate = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local tz
    const [feed, { predictions }] = await Promise.all([api(`/feed?date=${localDate}`), api('/predictions/mine')]);
    const preds = Object.fromEntries(predictions.map(p => [p.matchId, p]));
    const withMyPred = (m) => ({
      ...m,
      locked: isMatchLocked(m),
      myPrediction: preds[m.id] || null,
    });
    const j = feed.journey;
    el.innerHTML = `
      <div class="home-hero">
        <p class="hh-kicker">Matchday · World Cup 2026</p>
        <h2>Hi, ${esc(me.name.split(' ')[0])}</h2>
        <p class="hh-date">${new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      </div>

      ${j ? `
      <div class="journey">
        <h3><span class="big-flag">${flagHtml(j.team.flag)}</span> ${esc(j.team.name)} — your team</h3>
        <div class="journey-grid">
          <div class="jcell"><div class="jlabel">Next match</div>${j.nextMatch
            ? `${esc(j.nextMatch.teamAName)} vs ${esc(j.nextMatch.teamBName)}<br>${fmtDate(j.nextMatch.kickoff)} · ${fmtTime(j.nextMatch.kickoff)}`
            : 'TBD'}</div>
          <div class="jcell"><div class="jlabel">Last result</div>${j.lastMatch
            ? `${esc(j.lastMatch.teamAName)} ${j.lastMatch.scoreA}–${j.lastMatch.scoreB} ${esc(j.lastMatch.teamBName)}`
            : 'No matches yet'}</div>
          <div class="jcell"><div class="jlabel">Stage</div>${esc(j.team.group_name ? `Group ${j.team.group_name}` : 'Group Stage')}</div>
          <div class="jcell"><div class="jlabel">RC supporters</div>${j.team.supporters} fans</div>
        </div>
      </div>` : ''}

      ${feed.live.length ? `<div class="section-label live-label"><span class="live-dot"></span>Live now</div>${feed.live.map(m => matchCard(withMyPred(m), { withActions: false })).join('')}` : ''}

      <div class="section-label"><ion-icon name="calendar"></ion-icon>Today's matches</div>
      ${feed.today.length ? feed.today.map(m => matchCard(withMyPred(m))).join('') : '<div class="card empty">No matches today.</div>'}

      ${feed.finished.length ? `<div class="section-label"><ion-icon name="checkmark-done"></ion-icon>Recent results</div>${feed.finished.slice(0, 3).map(m => matchCard(m, { withActions: false })).join('')}` : ''}

      <div class="section-label"><ion-icon name="trophy"></ion-icon>Top 5 leaderboard</div>
      <div class="card top5-card">${feed.top5.length ? feed.top5.map((r, i) => `
        <div class="top5-row">
          <div class="top5-rank ${['gold','silver','bronze'][i] || ''}">${['👑','🥈','🥉'][i] || (i + 1)}</div>
          <span class="top5-name">${esc(r.name)}</span>
          <b class="lb-pts">${r.totalPoints} pts</b>
        </div>`).join('')
        : '<div class="empty">No points yet — make your predictions!</div>'}
        <div style="text-align:center;margin-top:10px"><a href="#leaderboard" class="btn small ghost">Full leaderboard</a></div>
      </div>`;

    bindPredictButtons(el, feed.today.map(withMyPred));
    schedulePoll();
  }

  // ---------- Matches ----------
  let matchesTab = 'fixtures';
  async function renderMatches() {
    const el = $('#view-matches');
    el.innerHTML = `
      <header class="page-head"><h2>Matches</h2><p>All World Cup fixtures. Predict before kickoff!</p></header>
      <div id="matchesBody"></div>`;
    const body = $('#matchesBody');
    {
      const { matches } = await api('/matches');
      const byDate = {};
      for (const m of matches) {
        const d = fmtDate(m.kickoff);
        (byDate[d] = byDate[d] || []).push(m);
      }
      body.innerHTML = Object.entries(byDate).map(([d, ms]) =>
        `<div class="date-head">${d}</div>${ms.map(m => matchCard(m)).join('')}`).join('')
        || '<div class="card empty">No matches yet. Admin needs to sync fixtures.</div>';
      bindPredictButtons(body, matches);
      schedulePoll();
    }
  }

  async function renderStandings(container) {
    container.innerHTML = '<div class="card empty">Loading standings…</div>';
    try {
      const data = await api('/standings');
      const groups = data?.groups || {};
      const updatedAt = data?.updatedAt;
      const groupNames = Object.keys(groups).sort();
      if (!groupNames.length) {
        container.innerHTML = '<div class="card empty">No standings yet — sync fixtures first.</div>';
        return;
      }
      const lastUp = updatedAt ? `<p class="standings-updated">Updated ${new Date(updatedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</p>` : '';
      container.innerHTML = lastUp + groupNames.map(g => `
        <div class="standings-group">
          <div class="standings-group-title">${esc(g)}</div>
          <div class="standings-table">
            <div class="st-head">
              <span class="st-team">Team</span>
              <span class="st-num">P</span><span class="st-num">W</span>
              <span class="st-num">D</span><span class="st-num">L</span>
              <span class="st-num">GD</span><span class="st-num st-pts">Pts</span>
            </div>
            ${groups[g].map((r, i) => `
              <div class="st-row ${i < 2 ? 'st-qualify' : ''}">
                <span class="st-rank">${r.position || i + 1}</span>
                <span class="st-flag"><img src="${esc(r.teamFlag || '')}" alt="" onerror="this.style.display='none'" /></span>
                <span class="st-name">${esc(r.teamCode || r.teamName)}</span>
                <span class="st-num">${r.played}</span>
                <span class="st-num">${r.won}</span>
                <span class="st-num">${r.drawn}</span>
                <span class="st-num">${r.lost}</span>
                <span class="st-num">${r.goalDiff > 0 ? '+' : ''}${r.goalDiff}</span>
                <span class="st-num st-pts">${r.points}</span>
              </div>`).join('')}
          </div>
        </div>`).join('');
    } catch(e) {
      container.innerHTML = `<div class="card empty">Could not load standings: ${esc(e.message)}</div>`;
    }
  }

  // ---------- Leaderboard ----------
  let lbTab = 'overall';
  async function renderLeaderboard() {
    const el = $('#view-leaderboard');
    el.innerHTML = `
      <header class="page-head"><h2>Leaderboard</h2><p>Right result: 3 pts · Exact score: 8 pts</p></header>
      <div class="tabs">
        <button class="tab ${lbTab === 'overall' ? 'active' : ''}" data-t="overall"><ion-icon name="globe"></ion-icon> Overall</button>
        <button class="tab ${lbTab === 'team' ? 'active' : ''}" data-t="team"><ion-icon name="flag"></ion-icon> My team fans</button>
      </div>
      <div id="lbBody"></div>`;
    el.querySelectorAll('.tab').forEach(t => t.onclick = () => { lbTab = t.dataset.t; renderLeaderboard(); });

    const body = $('#lbBody');
    const data = await api(`/leaderboard?type=${lbTab}`);
    body.innerHTML = data.rows.length ? data.rows.map((r, i) => `
      <div class="lb-row ${r.id === me.id ? 'lb-me' : ''}">
        <div class="lb-rank ${['gold','silver','bronze'][i] || ''}">${['👑','🥈','🥉'][i] || (i + 1)}</div>
        <img class="lb-avatar" src="${esc(r.profilePicture || avatarFallback(r.name))}" alt="">
        <div class="lb-main"><div class="lb-name">${esc(r.name)}</div>
          <div class="lb-sub">${flagHtml(r.favoriteTeamFlag, '')} ${esc(r.favoriteTeamName || '')}</div></div>
        <div class="lb-pts">${r.totalPoints}</div>
      </div>`).join('') : '<div class="card empty">Nobody on this board yet.</div>';
  }

  // ---------- Supporters ----------
  async function renderSupporters() {
    const el = $('#view-supporters');
    const { teams } = await api('/teams');
    teamsCache = teams;
    const supported = teams.filter(t => t.supporters > 0).sort((a, b) => b.supporters - a.supporters);
    el.innerHTML = `
      <header class="page-head"><h2>Team supporters</h2><p>Who's backing whom at Retailcloud.</p></header>
      ${supported.length ? supported.map(t => `
        <div class="lb-row" data-team="${t.id}" style="cursor:pointer">
          <span class="team-flag-badge">${flagHtml(t.flag)}</span>
          <div class="lb-main"><div class="lb-name">${esc(t.name)}</div>
            <div class="lb-sub">${t.supporters} fan${t.supporters === 1 ? '' : 's'}</div></div>
          <div class="lb-pts">${t.supporters} fans</div>
        </div>
        <div class="hidden" id="sup-${t.id}" style="margin:-4px 0 10px 44px"></div>
      `).join('') : '<div class="card empty">No favorites picked yet.</div>'}`;
    el.querySelectorAll('[data-team]').forEach(row => {
      row.onclick = async () => {
        const id = row.dataset.team;
        const box = $(`#sup-${id}`);
        if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
        const { supporters } = await api(`/teams/${id}/supporters`);
        box.innerHTML = supporters.map(s =>
          `<div class="news-item">${esc(s.name)}
           <b class="lb-pts" style="margin-left:auto">${s.totalPoints}</b></div>`).join('');
        box.classList.remove('hidden');
      };
    });
  }

  // ---------- Profile ----------
  async function renderProfile() {
    const el = $('#view-profile');
    await refreshMe();
    const team = teamsCache?.find(t => t.id === me.favoriteTeamId)
      || (await api('/teams')).teams.find(t => t.id === me.favoriteTeamId);
    el.innerHTML = `
      <header class="page-head"><h2>My profile</h2></header>
      <div class="card">
        <div class="profile-head">
          <img src="${esc(me.profilePicture || avatarFallback(me.name))}" alt="">
          <div><div class="pname">${esc(me.name)}</div><div class="pmail">${esc(me.email)}</div></div>
        </div>
        <div class="news-item"><span class="news-tag">Team</span> ${team ? `<span class="st-flag">${flagHtml(team.flag)}</span> ${esc(team.name)}` : '—'}</div>
        <div class="news-item"><span class="news-tag">Location</span> ${esc(me.location || 'Not set')}</div>
        <div class="news-item"><span class="news-tag">Points</span> <b class="lb-pts">${me.totalPoints}</b></div>
      </div>
      <div class="card">
        <h3>Settings</h3>
        <div class="pick-extras">
          <label>Location <input id="profLoc" value="${esc(me.location || '')}"></label>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="btn small" id="profSave">Save</button>
          <button class="btn small ghost" id="changeTeam">Change favorite team</button>
          <button class="btn small danger" id="logoutBtn">Sign out</button>
        </div>
      </div>`;
    $('#profSave').onclick = async () => {
      await api('/me', { method: 'PATCH', body: { location: $('#profLoc').value } });
      toast('Saved'); refreshMe();
    };
    $('#changeTeam').onclick = () => renderPickTeam();
    $('#logoutBtn').onclick = logout;
  }

  // ---------- Admin ----------
  let adminTab = 'matches';
  async function renderAdmin() {
    const el = $('#view-admin');
    el.innerHTML = `
      <header class="page-head"><h2>Admin panel</h2><p>Sync data, fix results, manage the contest.</p></header>
      <div class="card" id="agentCard" style="font-size:.8rem;color:var(--muted-foreground)">Checking live agent…</div>
      <div class="admin-actions">
        <button class="btn small" id="adSync"><ion-icon name="sync"></ion-icon> Sync matches</button>
        <button class="btn small ghost" id="adRecalc"><ion-icon name="calculator"></ion-icon> Recalculate points</button>
        <button class="btn small danger" id="adReset"><ion-icon name="trash"></ion-icon> Reset leaderboard</button>
      </div>
      <div class="tabs">
        <button class="tab ${adminTab === 'matches' ? 'active' : ''}" data-t="matches">Matches</button>
        <button class="tab ${adminTab === 'employees' ? 'active' : ''}" data-t="employees">Employees</button>
        <button class="tab ${adminTab === 'predictions' ? 'active' : ''}" data-t="predictions">Predictions</button>
      </div>
      <div id="adminBody" class="card table-wrap"></div>`;
    el.querySelectorAll('.tab').forEach(t => t.onclick = () => { adminTab = t.dataset.t; renderAdmin(); });

    api('/admin/agent').then(({ agent }) => {
      const last = agent.lastSync;
      $('#agentCard').innerHTML = `
        <b style="color:${agent.running ? 'var(--success)' : 'var(--destructive)'}">${agent.running ? 'Live agent running' : 'Live agent off'}</b>
        — mode: <b>${agent.mode}</b> (${agent.mode === 'live' ? `polling every ${agent.livePollSeconds}s` : `polling every ${agent.idlePollMinutes}m`})<br>
        Last sync: ${last.at ? new Date(last.at).toLocaleTimeString() : '—'} ·
        <span style="color:${last.ok === false ? 'var(--destructive)' : 'inherit'}">${esc(last.detail)}</span>`;
    }).catch(() => { $('#agentCard').textContent = 'Live agent status unavailable.'; });

    $('#adSync').onclick = async () => {
      $('#adSync').disabled = true;
      try {
        const r = await api('/admin/sync', { method: 'POST' });
        toast(`Synced ${r.fixtures} fixtures from ${r.provider}`);
        renderAdmin();
      } catch (e) { toast(e.message, true); $('#adSync').disabled = false; }
    };
    $('#adRecalc').onclick = async () => {
      await api('/admin/recalculate', { method: 'POST' });
      toast('Points recalculated'); refreshMe();
    };
    $('#adReset').onclick = async () => {
      if (!confirm('Reset the leaderboard? All scored points will be cleared (predictions are kept).')) return;
      await api('/admin/reset-leaderboard', { method: 'POST' });
      toast('Leaderboard reset'); refreshMe(); renderAdmin();
    };

    const body = $('#adminBody');
    if (adminTab === 'employees') {
      const { employees } = await api('/admin/employees');
      body.innerHTML = `<table class="admin"><tr><th>Name</th><th>Email</th><th>Dept</th><th>Team</th><th>Pts</th></tr>
        ${employees.map(e => `<tr><td>${esc(e.name)}</td><td>${esc(e.email)}</td><td>${esc(e.department || '')}</td>
          <td>${esc(e.favoriteTeamName || '')}</td><td><b>${e.totalPoints}</b></td></tr>`).join('')}</table>
        <p style="font-size:.75rem;color:var(--muted-foreground)">${employees.length} signed-in employees</p>`;
      return;
    }
    if (adminTab === 'predictions') {
      const { predictions } = await api('/admin/predictions');
      body.innerHTML = `<table class="admin"><tr><th>Employee</th><th>Match</th><th>Pick</th><th>Pts</th></tr>
        ${predictions.map(p => `<tr><td>${esc(p.employee)}</td><td>${esc(p.teamA)} v ${esc(p.teamB)}</td>
          <td>${p.scoreA}–${p.scoreB}</td><td>${p.points ?? '—'}</td></tr>`).join('')}</table>
        <p style="font-size:.75rem;color:var(--muted-foreground)">${predictions.length} predictions</p>`;
      return;
    }
    // matches tab — manual result editing
    const { matches } = await api('/matches');
    body.innerHTML = `<table class="admin"><tr><th>Match</th><th>Kickoff</th><th>Status</th><th>Result</th><th></th><th>Predict</th></tr>
      ${matches.map(m => `<tr>
        <td>${esc(m.teamAName)} v ${esc(m.teamBName)}</td>
        <td>${new Date(m.kickoff).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
        <td><span class="status-badge status-${m.status}">${m.status}</span></td>
        <td><div class="result-edit">
          <input type="number" min="0" id="ra-${m.id}" value="${m.scoreA ?? ''}">–
          <input type="number" min="0" id="rb-${m.id}" value="${m.scoreB ?? ''}">
        </div></td>
        <td><button class="btn small" data-finish="${m.id}">Set FT</button></td>
        <td><button class="btn small ${m.predictionOverride ? 'orange' : 'ghost'}" data-unlock="${m.id}" data-state="${m.predictionOverride ? '1' : '0'}">${m.predictionOverride ? 'Unlocked' : 'Unlock'}</button></td>
      </tr>`).join('')}</table>`;
    body.querySelectorAll('[data-finish]').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.finish;
        const a = $(`#ra-${id}`).value, b = $(`#rb-${id}`).value;
        if (a === '' || b === '') { toast('Enter both scores.', true); return; }
        try {
          await api(`/admin/matches/${id}/result`, { method: 'POST', body: { scoreA: Number(a), scoreB: Number(b), status: 'finished' } });
          toast('Result saved, points updated');
          renderAdmin(); refreshMe();
        } catch (e) { toast(e.message, true); }
      };
    });
    body.querySelectorAll('[data-unlock]').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.unlock;
        const unlock = btn.dataset.state !== '1';
        try {
          await api(`/admin/matches/${id}/unlock`, { method: 'POST', body: { unlock } });
          toast(unlock ? 'Predictions unlocked' : 'Predictions re-locked');
          renderAdmin();
        } catch (e) { toast(e.message, true); }
      };
    });
  }

  // ---------- Live polling (refresh home/matches every 60s when live games on) ----------
  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => {
      const view = location.hash.replace('#', '') || 'home';
      if (me && (view === 'home' || view === 'matches') && $('#modal').classList.contains('hidden')) route();
    }, 60_000);
  }

  init();
})();
