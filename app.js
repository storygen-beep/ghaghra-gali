(function(){
  const SUPABASE_URL = 'https://gmwmqfwhdnzucffxrgxw.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdtd21xZndoZG56dWNmZnhyZ3h3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxNDc2MTUsImV4cCI6MjEwNDcyMzYxNX0.mNNWWPPHRZIi5Ts3dXlNF6jzJDxmv331rEaink18WmI';
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const UI_KEY = 'garba-gali-ui-v3';
  const BACKUP_KEY = 'garba-gali-last-backup';
  const RETURN_TIME = '10:00 AM';
  const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const GRID_DAYS = 31;

  // Dates are ISO strings (YYYY-MM-DD); parse at noon so no timezone shifts a day.
  const D = iso => new Date(iso + 'T12:00:00');
  const toIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (iso, n) => { const d = D(iso); d.setDate(d.getDate() + n); return toIso(d); };
  const diffDays = (a, b) => Math.round((D(b) - D(a)) / 864e5);
  const fmtDay = iso => { const d = D(iso); return `${WD[d.getDay()]} ${d.getDate()} ${MO[d.getMonth()]}`; };
  const fmtShort = iso => { const d = D(iso); return `${d.getDate()} ${MO[d.getMonth()]}`; };
  const isValidIso = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(D(s));
  const TODAY = toIso(new Date());

  const NAVRATRI_START = '2026-10-11';
  const FESTIVAL = {};
  for (let i = 0; i < 9; i++) FESTIVAL[addDays(NAVRATRI_START, i)] = 'Night ' + (i + 1);
  FESTIVAL['2026-10-20'] = 'Dussehra';

  const COLOURS = {
    Red:'#C0243C', Maroon:'#7A1530', Pink:'#D6417A', Orange:'#E0701E', Yellow:'#E3B21C',
    Green:'#2E8B57', Teal:'#0F7C7C', Blue:'#2748A8', Purple:'#6B3FA0', Black:'#262124',
    White:'#EDE8E0', Multicolour:'conic-gradient(#C0243C 0 25%,#E3B21C 0 50%,#2E8B57 0 75%,#2748A8 0)'
  };
  const SIZES = ['S','M','L','XL','Free size'];
  const DEPOSIT_STATES = ['Not collected','Held','Refunded'];
  const CAL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>';

  /* ---------- state ---------- */
  let state = { lehengas: [], bookings: [] };
  let db = null, assets = null, downloads = null;
  let storeState = 'connecting';   // connecting | ready | offline
  let peek = null, lastFocus = null;

  const DEFAULT_UI = { tab: 'Confirmed', freeOn: '', windowStart: addDays(TODAY, -2) };
  function loadUi(){
    try {
      const s = localStorage.getItem(UI_KEY);
      if (s) {
        const u = Object.assign({}, DEFAULT_UI, JSON.parse(s));
        if (!isValidIso(u.windowStart)) u.windowStart = DEFAULT_UI.windowStart;
        if (u.freeOn && !isValidIso(u.freeOn)) u.freeOn = '';
        return u;
      }
    } catch (e) {}
    return Object.assign({}, DEFAULT_UI);
  }
  function saveUi(){ try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) {} }
  let ui = loadUi();
  ui.today = TODAY;   // the shown day resets to the real today on every load

  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const inr = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  const lehengaById = id => state.lehengas.find(l => l.id === id);
  const nightsOf = b => Math.max(1, diffDays(b.from, b.to) + 1);
  const returnDue = b => addDays(b.to, 1);
  const statusOf = b => b.cancelled ? 'Cancelled' : (Number(b.advance) > 0 ? 'Confirmed' : 'Enquiry');
  const rentOf = b => { const l = lehengaById(b.lehengaId); return l ? Math.max(0, l.rent * nightsOf(b) - (Number(b.discount) || 0)) : 0; };
  const depositOf = b => { const l = lehengaById(b.lehengaId); return l ? Number(l.deposit) || 0 : 0; };
  const balanceOf = b => statusOf(b) === 'Cancelled' ? 0 : Math.max(0, rentOf(b) + depositOf(b) - (Number(b.advance) || 0));
  const overlaps = (a, b) => a.from <= b.to && b.from <= a.to;
  const firstName = name => (String(name || '').trim().split(/\s+/)[0] || 'Booked');
  const dateRange = b => b.from === b.to ? fmtDay(b.from) : `${fmtDay(b.from)} – ${fmtDay(b.to)}`;
  const rangeShort = (from, to) => {
    if (from === to) return fmtShort(from);
    const a = D(from), b = D(to);
    return a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${MO[b.getMonth()]}` : `${fmtShort(from)} – ${fmtShort(to)}`;
  };
  const telHref = p => 'tel:' + String(p || '').replace(/[^\d+]/g, '');
  const pill = st => `<span class="pill pill-${st.toLowerCase()}">${st}</span>`;
  const fmtCreated = iso => {
    const d = new Date(String(iso).length <= 10 ? iso + 'T12:00:00' : iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const photoSrc = l => l.photoPath ? `${SUPABASE_URL}/storage/v1/object/public/photos/${l.photoPath}` : null;

  function gridDays(){
    const out = [];
    let x = ui.windowStart;
    for (let i = 0; i < GRID_DAYS; i++) { out.push(x); x = addDays(x, 1); }
    return out;
  }

  // Confirmed bookings on a lehenga, other than the one being edited
  function holdingBookings(lehengaId, excludeId){
    return state.bookings
      .filter(o => o.lehengaId === lehengaId && o.id !== excludeId && statusOf(o) === 'Confirmed')
      .sort((a, b) => a.from < b.from ? -1 : a.from > b.from ? 1 : 0);
  }
  function conflictsFor(b){
    if (statusOf(b) !== 'Confirmed') return [];
    return holdingBookings(b.lehengaId, b.id).filter(o => overlaps(o, b));
  }
  // lehengaId -> iso -> confirmed bookings holding that night
  function nightMap(){
    const m = {};
    state.lehengas.forEach(l => { m[l.id] = {}; });
    state.bookings.forEach(b => {
      if (statusOf(b) !== 'Confirmed' || !m[b.lehengaId]) return;
      for (let x = b.from; x <= b.to; x = addDays(x, 1)) (m[b.lehengaId][x] = m[b.lehengaId][x] || []).push(b);
    });
    return m;
  }
  // lehengaId -> iso -> booking whose lehenga comes back that morning
  function returnMap(){
    const m = {};
    state.bookings.forEach(b => {
      if (statusOf(b) !== 'Confirmed') return;
      (m[b.lehengaId] = m[b.lehengaId] || {})[returnDue(b)] = b;
    });
    return m;
  }
  // Collapse a lehenga's booked nights into ranges like "13–15 Oct"
  function bookedRanges(lehengaId, m){
    const days = Object.keys(m[lehengaId] || {}).sort();
    const out = [];
    days.forEach(d => {
      const last = out[out.length - 1];
      if (last && addDays(last.to, 1) === d) last.to = d; else out.push({ from: d, to: d });
    });
    return out;
  }

  function photoHtml(l){
    const src = photoSrc(l);
    if (src) return `<img src="${src}" alt="${esc(l.title)}" loading="lazy">`;
    return `<span class="ph-empty">No photo yet</span>`;
  }

  /* ---------- store: Supabase ---------- */
  const lehengaFromRow = r => ({
    id: r.id, code: r.code || '', title: r.title, rent: Number(r.rent) || 0,
    deposit: Number(r.deposit) || 0, colour: r.colour || '', size: r.size || '',
    photoPath: r.photo_path || null, createdAt: r.created_at
  });
  const lehengaToRow = l => ({
    code: l.code || null, title: l.title, rent: l.rent, deposit: l.deposit,
    colour: l.colour || null, size: l.size || null, photo_path: l.photoPath || null
  });
  const bookingFromRow = r => ({
    id: r.id, lehengaId: r.lehenga_id, name: r.name, phone: r.phone || '',
    from: r.from_date, to: r.to_date, payment: r.payment || 'Online',
    advance: Number(r.advance) || 0, discount: Number(r.discount) || 0,
    cancelled: !!r.cancelled, returned: !!r.returned,
    depositStatus: r.deposit_status || 'Not collected', createdAt: r.created_at
  });
  const bookingToRow = b => ({
    lehenga_id: b.lehengaId, name: b.name, phone: b.phone || null,
    from_date: b.from, to_date: b.to, payment: b.payment, advance: b.advance,
    discount: b.discount, cancelled: b.cancelled, returned: b.returned,
    deposit_status: b.depositStatus
  });

  let signedIn = false;

  async function fetchBoth(){
    return Promise.all([
      sb.from('lehengas').select('*').order('code', { nullsFirst: false }),
      sb.from('bookings').select('*')
    ]);
  }

  async function loadAll(){
    let [lehengas, bookings] = await fetchBoth();
    if (lehengas.error || bookings.error) {
      await new Promise(r => setTimeout(r, 700));
      [lehengas, bookings] = await fetchBoth();
    }
    if (lehengas.error || bookings.error) {
      storeState = 'offline';
      renderStoreNote();
      return;
    }
    state.lehengas = lehengas.data.map(lehengaFromRow);
    state.bookings = bookings.data.map(bookingFromRow);
    storeState = 'ready';
    renderStoreNote();
    render();
  }

  function watchChanges(){
    sb.channel('garba-gali')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lehengas' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, loadAll)
      .subscribe();
  }

  async function connect(){
    const { data } = await sb.auth.getSession();
    await applySession(data.session);
    sb.auth.onAuthStateChange((_e, session) => applySession(session));
  }

  async function applySession(session){
    signedIn = !!session;
    $('#login').hidden = signedIn;
    $('#app').hidden = !signedIn;
    $('#who').textContent = session ? session.user.email : '';
    if (!signedIn) { storeState = 'offline'; renderStoreNote(); return; }
    await loadAll();
    watchChanges();
  }

  async function signIn(btn){
    const email = $('#login-email').value.trim();
    const password = $('#login-pass').value;
    const err = $('#login-err');
    err.hidden = true;
    if (!email || !password) { err.textContent = 'Enter your email and password.'; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = 'Signing in…';
    const { error } = await sb.auth.signInWithPassword({ email, password });
    btn.disabled = false; btn.textContent = 'Sign in';
    if (error) {
      err.textContent = /invalid/i.test(error.message) ? 'That email and password do not match.' : error.message;
      err.hidden = false;
    }
  }

  async function signOut(){
    await sb.auth.signOut();
    state = { lehengas: [], bookings: [] };
    render();
  }

  function requireStore(){
    if (signedIn) return true;
    toast('You are signed out, so nothing was saved. Sign in again.');
    return false;
  }

  function renderStoreNote(){
    const el = $('#store-note');
    if (!el) return;
    if (storeState === 'ready') {
      el.textContent = 'Saved automatically. Everyone signed in sees the same bookings.';
      el.className = 'store-note ok';
    } else if (signedIn) {
      el.textContent = 'Could not reach the data. Check the connection and reload.';
      el.className = 'store-note bad';
    } else {
      el.textContent = '';
      el.className = 'store-note';
    }
  }

  /* ---------- page sections ---------- */
  function renderMeta(){
    const confirmed = state.bookings.filter(b => statusOf(b) === 'Confirmed').length;
    $('#meta-counts').textContent = state.lehengas.length
      ? `${state.lehengas.length} lehenga${state.lehengas.length > 1 ? 's' : ''} · ${confirmed} confirmed booking${confirmed === 1 ? '' : 's'}`
      : '';
  }

  function renderClashes(){
    const clashing = state.bookings.filter(b => conflictsFor(b).length);
    const el = $('#clashes');
    if (!state.lehengas.length) { el.innerHTML = ''; return; }
    if (!clashing.length) {
      el.innerHTML = `<div class="ok-line"><span class="ok-dot" aria-hidden="true"></span><span><b>Clashes: none.</b> Every confirmed booking has its lehenga to itself.</span></div>`;
      return;
    }
    el.innerHTML = `<div class="clash-box" role="alert">
      <strong>⚠ ${clashing.length} bookings clash</strong>
      <p>Same lehenga, same night, both confirmed. Move one of them to another lehenga or night.</p>
      <ul>${clashing.map(b => `<li><button class="linkish" data-action="open-booking" data-id="${b.id}">${esc(b.name || 'Untitled')}</button> · ${esc((lehengaById(b.lehengaId) || {}).code || '')} · ${dateRange(b)}</li>`).join('')}</ul>
    </div>`;
  }

  function renderToday(){
    const t = ui.today;
    $('#today-label').textContent = fmtDay(t) + (t === TODAY ? '' : ' (not today)');
    $('#today-pick').value = t;
    const active = state.bookings.filter(b => statusOf(b) === 'Confirmed' && lehengaById(b.lehengaId));
    const byDue = (a, b) => returnDue(a) < returnDue(b) ? -1 : 1;
    const late = active.filter(b => returnDue(b) < t && !b.returned).sort(byDue);
    const dueToday = active.filter(b => returnDue(b) === t);
    const backRows = late.concat(dueToday);
    const outTonight = active.filter(b => b.from === t);
    const pendingBack = dueToday.filter(b => !b.returned).length + late.length;

    const backRow = b => {
      const l = lehengaById(b.lehengaId);
      const isLate = returnDue(b) < t;
      const status = b.returned ? '<span class="pill back">Back</span>'
        : isLate ? `<span class="pill late">Late · was due ${fmtShort(returnDue(b))}</span>`
        : `<span class="muted">by ${RETURN_TIME}</span>`;
      return `<div class="trow${b.returned ? ' done' : ''}">
        <input type="checkbox" class="cb" id="ret-${b.id}" data-return="${b.id}"${b.returned ? ' checked' : ''}>
        <label class="t-main" for="ret-${b.id}">${l.code ? `<span class="code">${esc(l.code)}</span> ` : ''}<b>${esc(l.title)}</b><span class="t-sub">${esc(b.name)} · wore it ${rangeShort(b.from, b.to)}</span></label>
        <div class="t-side">${status}${b.phone ? `<a class="phone" href="${telHref(b.phone)}">${esc(b.phone)}</a>` : ''}</div>
      </div>`;
    };
    $('#panel-back').innerHTML = `
      <div class="panel-h"><b>Coming back by ${RETURN_TIME}</b><span class="muted">${backRows.length ? `${pendingBack} still to come · tick when it's back` : ''}</span></div>
      ${backRows.length ? backRows.map(backRow).join('') : `<div class="t-empty">Nothing due back on ${fmtDay(t)}.</div>`}`;

    $('#panel-out').innerHTML = `
      <div class="panel-h"><b>Going out tonight</b><span class="muted">${outTonight.length ? `${outTonight.length} pickup${outTonight.length > 1 ? 's' : ''}` : ''}</span></div>
      ${outTonight.length ? outTonight.map(b => {
        const l = lehengaById(b.lehengaId);
        return `<div class="trow out">
          <button class="t-main name-btn" data-action="open-booking" data-id="${b.id}" style="font-weight:400">${l.code ? `<span class="code">${esc(l.code)}</span> ` : ''}<b>${esc(l.title)}</b><span class="t-sub">${esc(b.name)} · ${nightsOf(b)} night${nightsOf(b) > 1 ? 's' : ''}, back ${fmtShort(returnDue(b))} ${RETURN_TIME}</span></button>
          <div class="t-side"><span>Collect <span class="collect">${inr(balanceOf(b))}</span></span>${b.phone ? `<a class="phone" href="${telHref(b.phone)}">${esc(b.phone)}</a>` : ''}</div>
        </div>`;
      }).join('') : `<div class="t-empty">No pickups on ${fmtDay(t)}.</div>`}`;
  }

  function gridCell(l, iso, arr, retB){
    const cls = iso === ui.today ? ' class="today"' : '';
    const label = `${esc(l.code || l.title)} on ${fmtDay(iso)}`;
    if (!arr || !arr.length) {
      const retTitle = retB ? ` title="${esc(retB.name)} brings it back by ${RETURN_TIME}"` : '';
      return `<td${cls}><button class="cell free${retB ? ' ret' : ''}" data-action="cell-free" data-lehenga="${l.id}" data-date="${iso}" aria-label="${label}: free. Book it."${retTitle}><span class="when-idle">Free</span><span class="when-hover">+ Book</span></button></td>`;
    }
    if (arr.length === 1) {
      const b = arr[0];
      const s = b.from === iso, e = b.to === iso;
      const showName = s || iso === ui.windowStart;
      return `<td${cls}><button class="cell bk" data-action="open-booking" data-id="${b.id}" title="${esc(b.name)} · ${dateRange(b)} · back ${fmtShort(returnDue(b))} ${RETURN_TIME}" aria-label="${label}: booked by ${esc(b.name)}"><span class="bar${s ? ' s' : ''}${e ? ' e' : ''}">${showName ? esc(firstName(b.name)) : '&nbsp;'}</span></button></td>`;
    }
    return `<td${cls}><button class="cell" data-action="open-booking" data-id="${arr[0].id}" title="${arr.map(b => esc(b.name)).join(' and ')}" aria-label="${label}: clash, ${arr.length} bookings"><span class="chip clash">⚠ ${arr.length}</span></button></td>`;
  }

  function renderGrid(){
    const wrap = $('#grid-wrap');
    if (!state.lehengas.length) {
      wrap.innerHTML = `<div class="empty">Add a lehenga and this grid fills with every date, so you can see at a glance what is free.</div>`;
      return;
    }
    wrap.innerHTML = `<div class="scroll" id="grid-scroll"><table class="grid" id="grid"></table></div>`;
    const days = gridDays();
    const m = nightMap(), r = returnMap();
    const head = `<thead><tr><th class="lh" scope="col">Lehenga</th>${days.map(iso => {
      const d = D(iso), fest = FESTIVAL[iso];
      const cls = [fest ? 'nav' : '', iso === ui.today ? 'today' : ''].filter(Boolean).join(' ');
      return `<th scope="col"${cls ? ` class="${cls}"` : ''} data-date="${iso}"><span class="n">${WD[d.getDay()]} ${d.getDate()}</span><span class="d">${fest || (iso === ui.today ? 'Today' : (d.getDate() === 1 ? MO[d.getMonth()] : ''))}</span></th>`;
    }).join('')}</tr></thead>`;
    const body = state.lehengas.map(l => `<tr><th scope="row" class="lh"><button class="lh-btn" data-action="open-lehenga" data-id="${l.id}">${photoSrc(l) ? `<img class="lh-thumb" src="${photoSrc(l)}" alt="" loading="lazy">` : '<span class="lh-thumb blank" aria-hidden="true"></span>'}<span class="lh-text">${l.code ? `<span class="code">${esc(l.code)}</span>` : ''}<span class="lh-title">${esc(l.title)}</span></span></button></th>${days.map(iso => gridCell(l, iso, m[l.id][iso], (r[l.id] || {})[iso])).join('')}</tr>`).join('');
    const foot = `<tfoot><tr><td class="lh">Free that night</td>${days.map(iso => {
      const c = state.lehengas.filter(l => !(m[l.id][iso] || []).length).length;
      return `<td${iso === ui.today ? ' class="today"' : ''}><b>${c}</b> of ${state.lehengas.length}</td>`;
    }).join('')}</tr></tfoot>`;
    $('#grid').innerHTML = head + `<tbody>${body}</tbody>` + foot;
    scrollGridTo(ui.today, false);
  }

  function scrollGridTo(iso, smooth){
    const sc = $('#grid-scroll');
    if (!sc) return;
    const th = sc.querySelector(`thead th[data-date="${iso}"]`);
    const lh = sc.querySelector('thead .lh');
    if (!th || !lh) return;
    // Put the day one column in from the sticky lehenga column, so yesterday stays visible.
    const left = Math.max(0, th.offsetLeft - lh.offsetWidth - th.offsetWidth);
    sc.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
  }

  function shiftWindow(days){
    ui.windowStart = addDays(ui.windowStart, days);
    saveUi(); renderGrid();
  }

  function renderGallery(){
    const m = nightMap();
    let list = state.lehengas;
    if (ui.freeOn) list = list.filter(l => !(m[l.id][ui.freeOn] || []).length);
    $('#free-on').value = ui.freeOn || '';
    $('#free-on-clear').hidden = !ui.freeOn;
    if (!state.lehengas.length) {
      $('#gallery').innerHTML = `<div class="empty" style="grid-column:1/-1"><b>No lehengas yet.</b><br>Press <b>+ New lehenga</b> to add your first one: photo, title, rent per night and deposit.</div>`;
      return;
    }
    if (!list.length) {
      $('#gallery').innerHTML = `<div class="empty" style="grid-column:1/-1">Every lehenga is booked on ${fmtDay(ui.freeOn)}.</div>`;
      return;
    }
    $('#gallery').innerHTML = list.map(l => {
      const ranges = bookedRanges(l.id, m);
      const bookedHtml = ranges.length
        ? `<span>Booked</span>${ranges.map(x => `<span class="nchip">${rangeShort(x.from, x.to)}</span>`).join('')}`
        : `<span class="free-all">No bookings yet</span>`;
      return `<article class="card">
        <button class="ph" data-action="open-lehenga" data-id="${l.id}" aria-label="Open ${esc(l.title)}">${photoHtml(l)}</button>
        <div class="body">
          ${l.code ? `<span class="code">${esc(l.code)}</span>` : ''}
          <button class="card-title" data-action="open-lehenga" data-id="${l.id}">${esc(l.title)}</button>
          <div class="price"><b>${inr(l.rent)}</b> / night · ${inr(l.deposit)} deposit</div>
          <div class="tags">
            ${l.colour ? `<span class="tag"><span class="dot" style="background:${COLOURS[l.colour] || '#999'}"></span>${esc(l.colour)}</span>` : ''}
            ${l.size ? `<span class="tag">${esc(l.size)}</span>` : ''}
          </div>
          <div class="booked-line">${bookedHtml}</div>
          <button class="btn book" data-action="book" data-lehenga="${l.id}">${CAL} Book</button>
        </div>
      </article>`;
    }).join('');
  }

  function renderBookings(){
    const groups = { Confirmed: [], Enquiry: [], Cancelled: [] };
    state.bookings.forEach(b => groups[statusOf(b)].push(b));
    const labels = { Confirmed: 'Confirmed', Enquiry: 'Enquiries', Cancelled: 'Cancelled' };
    $('#tabs').innerHTML = Object.keys(groups).map(k => `<button class="tab" role="tab" data-action="tab" data-tab="${k}" aria-selected="${ui.tab === k}">${labels[k]}<span class="ct">${groups[k].length}</span></button>`).join('');
    const rows = (groups[ui.tab] || []).slice().sort((a, b) => a.from < b.from ? -1 : a.from > b.from ? 1 : 0);
    if (!rows.length) {
      const msg = state.lehengas.length
        ? { Confirmed: 'No confirmed bookings yet.', Enquiry: 'No enquiries. A booking saved without an advance lands here.', Cancelled: 'Nothing cancelled.' }[ui.tab]
        : 'Add a lehenga first, then you can take bookings.';
      $('#bookings').innerHTML = `<div class="empty" style="border:0">${msg}</div>`;
      return;
    }
    $('#bookings').innerHTML = `<div class="scroll"><table class="list">
      <thead><tr><th>Customer</th><th>Lehenga</th><th>Nights</th><th>Back by</th><th>Phone</th><th>Payment</th><th class="r">Rent</th><th class="r">Advance</th><th class="r">Balance due</th><th>Status</th></tr></thead>
      <tbody>${rows.map(b => {
        const l = lehengaById(b.lehengaId) || { code: '', title: 'Deleted lehenga' };
        const extra = (conflictsFor(b).length ? '<span class="chip clash">⚠ Clash</span>' : '') + (b.returned && statusOf(b) === 'Confirmed' ? '<span class="pill back">Back</span>' : '');
        return `<tr class="row" data-action="open-booking" data-id="${b.id}">
          <td><button class="name-btn" data-action="open-booking" data-id="${b.id}">${esc(b.name || 'Untitled')}</button></td>
          <td>${l.code ? `<span class="code">${esc(l.code)}</span> ` : ''}${esc(l.title)}</td>
          <td>${dateRange(b)}</td>
          <td class="small">${fmtShort(returnDue(b))}, ${RETURN_TIME}</td>
          <td class="mono small">${esc(b.phone || '')}</td>
          <td class="pay">${esc(b.payment || '')}</td>
          <td class="r">${inr(rentOf(b))}</td>
          <td class="r">${inr(b.advance)}</td>
          <td class="r"><b>${inr(balanceOf(b))}</b></td>
          <td><span class="pills">${pill(statusOf(b))}${extra}</span></td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  }

  function renderMoney(){
    const conf = state.bookings.filter(b => statusOf(b) === 'Confirmed');
    const adv = conf.reduce((s, b) => s + (Number(b.advance) || 0), 0);
    const online = conf.filter(b => b.payment === 'Online').reduce((s, b) => s + (Number(b.advance) || 0), 0);
    const bal = conf.reduce((s, b) => s + balanceOf(b), 0);
    const held = state.bookings.filter(b => statusOf(b) !== 'Cancelled' && b.depositStatus === 'Held');
    const heldSum = held.reduce((s, b) => s + depositOf(b), 0);
    $('#money').innerHTML = `
      <div class="fig"><div class="lbl">Advance collected</div><div class="val">${inr(adv)}</div><div class="sub">Online ${inr(online)} · Offline ${inr(adv - online)}</div></div>
      <div class="fig"><div class="lbl">Balance still to collect</div><div class="val">${inr(bal)}</div><div class="sub">Rent + deposit, due at pickup · ${conf.length} booking${conf.length === 1 ? '' : 's'}</div></div>
      <div class="fig"><div class="lbl">Deposits held</div><div class="val">${inr(heldSum)}</div><div class="sub">${held.length ? `${held.length} to refund when the lehenga comes back` : 'Taken at pickup. Mark a booking Held once collected.'}</div></div>`;
  }

  function render(){
    renderMeta(); renderClashes(); renderToday(); renderGrid(); renderGallery(); renderBookings(); renderMoney();
  }

  /* ---------- side peek ---------- */
  function openPeek(html, label){
    const p = $('#peek');
    if (p.hidden) lastFocus = document.activeElement;
    p.innerHTML = html;
    p.setAttribute('aria-label', label);
    p.hidden = false;
    $('#overlay').hidden = false;
    document.body.classList.add('peek-open');
    setTimeout(() => { const f = p.querySelector('[data-autofocus]') || p.querySelector('button'); if (f) f.focus(); }, 30);
  }
  function closePeek(){
    peek = null;
    $('#peek').hidden = true;
    $('#overlay').hidden = true;
    document.body.classList.remove('peek-open');
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  function openBooking(id, preset){
    if (!state.lehengas.length) { toast('Add a lehenga first.'); return; }
    const existing = id && state.bookings.find(b => b.id === id);
    const night = (preset && preset.date) || ui.today;
    const d = existing ? Object.assign({}, existing) : {
      id: null, name: '', phone: '', lehengaId: (preset && preset.lehengaId) || state.lehengas[0].id,
      from: night, to: night, payment: 'Online', advance: 0, discount: 0, cancelled: false, returned: false,
      depositStatus: 'Not collected', createdAt: new Date().toISOString()
    };
    peek = { type: 'booking', draft: d };
    openPeek(bookingPeekHtml(d), existing ? `Booking: ${d.name}` : 'New booking');
    updateBookingDerived();
  }

  function bookingPeekHtml(d){
    const isNew = !d.id;
    const lehengaOptions = state.lehengas.map(l => `<option value="${l.id}"${l.id === d.lehengaId ? ' selected' : ''}>${esc(l.code ? l.code + ' · ' : '')}${esc(l.title)}</option>`).join('');
    return `
      <div class="peek-head"><span class="crumb">Bookings / ${isNew ? 'New booking' : esc(d.name || 'Untitled')}</span><button class="icon-btn" data-action="close" aria-label="Close">✕</button></div>
      <div class="peek-body">
        <label class="sr" for="bk-name">Customer name</label>
        <input id="bk-name" class="title-input" placeholder="Customer name" value="${esc(d.name)}" autocomplete="off" data-autofocus>
        <p class="field-err" id="bk-err" hidden>Add the customer's name to save this booking.</p>
        <div class="props">
          <div class="k"><label for="bk-lehenga">Lehenga</label></div>
          <div class="v"><select id="bk-lehenga" class="f">${lehengaOptions}</select></div>
          <div class="k">Already booked on <span class="auto-tag">auto</span></div>
          <div class="v" id="bk-already"></div>
          <div class="k"><label for="bk-from">Nights</label></div>
          <div class="v"><input id="bk-from" class="f f-date" type="date" value="${d.from}" aria-label="First night"><span class="muted">to</span><input id="bk-to" class="f f-date" type="date" value="${d.to}" aria-label="Last night"></div>
          <div class="k"><label for="bk-phone">Phone</label></div>
          <div class="v"><input id="bk-phone" class="f mono" type="tel" inputmode="tel" placeholder="98xxx xxxxx" value="${esc(d.phone)}" autocomplete="off"></div>
          <div class="k">Payment method</div>
          <div class="v"><div class="seg" role="radiogroup" aria-label="Payment method">${['Online','Offline'].map(p => `<label><input type="radio" name="bk-pay" id="bk-pay-${p.toLowerCase()}" value="${p}"${d.payment === p ? ' checked' : ''}><span>${p}</span></label>`).join('')}</div></div>
          <div class="k"><label for="bk-advance">Advance paid</label></div>
          <div class="v"><span class="rs">₹</span><input id="bk-advance" class="f f-num" type="number" min="0" step="100" inputmode="numeric" value="${Number(d.advance) || ''}" placeholder="0"></div>
          <div class="k"><label for="bk-discount">Discount</label></div>
          <div class="v"><span class="rs">₹</span><input id="bk-discount" class="f f-num" type="number" min="0" step="50" inputmode="numeric" value="${Number(d.discount) || ''}" placeholder="0"></div>
          <div class="k"><label for="bk-deposit">Deposit status</label></div>
          <div class="v"><select id="bk-deposit" class="f f-sm">${DEPOSIT_STATES.map(s => `<option${s === d.depositStatus ? ' selected' : ''}>${s}</option>`).join('')}</select></div>
          <div class="k"><label for="bk-returned">Returned</label></div>
          <div class="v"><input id="bk-returned" type="checkbox" class="cb"${d.returned ? ' checked' : ''}></div>
          <div class="k"><label for="bk-cancelled">Cancelled</label></div>
          <div class="v"><input id="bk-cancelled" type="checkbox" class="cb"${d.cancelled ? ' checked' : ''}></div>
        </div>
        <div id="bk-warn"></div>
        <div class="divider"></div>
        <div class="props" id="bk-auto"></div>
      </div>
      <div class="peek-foot">
        <button class="btn primary" data-action="save-booking">Save booking</button>
        <button class="btn" data-action="close">Discard</button>
        ${isNew ? '' : `<button class="btn danger" data-action="delete-booking">Delete</button>`}
      </div>`;
  }

  function readBookingForm(){
    const d = peek.draft;
    d.name = $('#bk-name').value;
    d.lehengaId = $('#bk-lehenga').value;
    const from = $('#bk-from').value, to = $('#bk-to').value;
    if (isValidIso(from)) d.from = from;
    if (isValidIso(to)) d.to = to;
    if (d.to < d.from) { d.to = d.from; $('#bk-to').value = d.from; }
    d.phone = $('#bk-phone').value;
    const pay = document.querySelector('input[name="bk-pay"]:checked');
    d.payment = pay ? pay.value : 'Online';
    d.advance = Math.max(0, Number($('#bk-advance').value) || 0);
    d.discount = Math.max(0, Number($('#bk-discount').value) || 0);
    d.depositStatus = $('#bk-deposit').value;
    d.returned = $('#bk-returned').checked;
    d.cancelled = $('#bk-cancelled').checked;
  }

  function updateBookingDerived(){
    const d = peek.draft;
    const l = lehengaById(d.lehengaId);
    if (!l) return;
    const holding = holdingBookings(d.lehengaId, d.id);
    $('#bk-already').innerHTML = holding.length
      ? holding.map(o => `<span class="nchip" title="${esc(o.name)} · ${dateRange(o)}">${rangeShort(o.from, o.to)} · ${esc(firstName(o.name))}</span>`).join('')
      : `<span class="free-all">Nothing yet</span>`;

    const st = statusOf(d);
    const hits = holding.filter(o => overlaps(o, d));
    const code = l.code || l.title;
    let warn = '';
    if (st === 'Cancelled') {
      warn = `<div class="note-box">Cancelled bookings don't hold the lehenga and don't count in Money.</div>`;
    } else if (hits.length) {
      const who = hits.map(o => `${esc(o.name || 'Untitled')} (${dateRange(o)})`).join(', ');
      warn = st === 'Confirmed'
        ? `<div class="warn-box"><strong>⚠ Clash.</strong> ${esc(code)} is already booked by ${who}. Saving will flag both bookings. Pick another night or another lehenga.</div>`
        : `<div class="warn-box">${esc(code)} is already booked by ${who} on these nights, so this enquiry can't be confirmed as it stands.</div>`;
    } else if (st === 'Enquiry') {
      warn = `<div class="note-box">No advance yet, so this is an <b>Enquiry</b>. It doesn't hold ${esc(code)}. Enter the advance to confirm it.</div>`;
    } else {
      warn = `<div class="ok-box">${esc(code)} is free on ${dateRange(d)}. Saving holds it${d.name.trim() ? ` for ${esc(firstName(d.name))}` : ''}.</div>`;
    }
    $('#bk-warn').innerHTML = warn;

    const n = nightsOf(d), disc = Number(d.discount) || 0;
    $('#bk-auto').innerHTML = `
      <div class="k">Status <span class="auto-tag">auto</span></div>
      <div class="v">${pill(st)}${conflictsFor(d).length ? '<span class="chip clash">⚠ Clash</span>' : ''}</div>
      <div class="k">Return due <span class="auto-tag">auto</span></div>
      <div class="v">${fmtDay(returnDue(d))}, ${RETURN_TIME}</div>
      <div class="k">Rent <span class="auto-tag">auto</span></div>
      <div class="v"><b class="num">${inr(rentOf(d))}</b><span class="muted small">${inr(l.rent)} × ${n} night${n > 1 ? 's' : ''}${disc ? ` − ${inr(disc)} discount` : ''}</span></div>
      <div class="k">Deposit <span class="auto-tag">auto</span></div>
      <div class="v"><span class="num">${inr(depositOf(d))}</span><span class="muted small">refundable</span></div>
      <div class="k">Balance due <span class="auto-tag">auto</span></div>
      <div class="v"><b class="num big">${inr(balanceOf(d))}</b><span class="muted small">rent + deposit − advance</span></div>
      <div class="k">Created <span class="auto-tag">auto</span></div>
      <div class="v">${fmtCreated(d.createdAt)}</div>`;
  }

  function saveError(e, what){
    const code = e && e.code;
    if (code === '42501') return `You do not have permission to change this ${what}.`;
    if (code === '23503') return 'That lehenga has bookings, so it cannot be deleted.';
    return `Could not save the ${what}. Check your connection and try again.`;
  }

  async function saveBooking(btn){
    readBookingForm();
    const d = peek.draft;
    if (!d.name.trim()) { $('#bk-err').hidden = false; $('#bk-name').focus(); return; }
    if (!requireStore()) return;
    d.name = d.name.trim();
    const l = lehengaById(d.lehengaId);
    const st = statusOf(d);
    const clash = conflictsFor(d).length;
    const body = {
      name: d.name, phone: d.phone, lehengaId: d.lehengaId, from: d.from, to: d.to,
      payment: d.payment, advance: d.advance, discount: d.discount, cancelled: d.cancelled,
      returned: d.returned, depositStatus: d.depositStatus, createdAt: d.createdAt
    };
    btn.disabled = true;
    try {
      const row = bookingToRow(body);
      const res = d.id ? await sb.from('bookings').update(row).eq('id', d.id)
                       : await sb.from('bookings').insert(row);
      if (res.error) throw res.error;
      await loadAll();
      ui.tab = st; saveUi();
      closePeek();
      if (clash) toast(`Saved with a clash. ${l.code || l.title} now has two bookings on the same night.`);
      else if (st === 'Confirmed') toast(`Saved. ${l.code || l.title} is booked for ${firstName(d.name)} on ${dateRange(d)}, back ${fmtShort(returnDue(d))} by ${RETURN_TIME}.`);
      else if (st === 'Enquiry') toast(`Saved as an enquiry. ${l.code || l.title} stays free until the advance is paid.`);
      else toast('Saved as cancelled.');
    } catch (e) {
      btn.disabled = false;
      toast(saveError(e, 'booking'));
    }
  }

  function askDelete(kind){
    const foot = document.querySelector('.peek-foot');
    if (!foot) return;
    foot.innerHTML = `<span class="confirm-text">Delete this ${kind}? This cannot be undone.</span>
      <button class="btn solid-danger" data-action="delete-${kind}-now">Yes, delete</button>
      <button class="btn" data-action="delete-cancel">Keep it</button>`;
  }

  function cancelDelete(){
    const d = peek && peek.draft;
    if (!d) return closePeek();
    peek.type === 'lehenga' ? openLehenga(d.id) : openBooking(d.id);
  }

  async function deleteBooking(btn){
    if (!requireStore()) return;
    const d = peek.draft;
    btn.disabled = true;
    try {
      const res = await sb.from('bookings').delete().eq('id', d.id);
      if (res.error) throw res.error;
      await loadAll();
      closePeek();
      toast(`Deleted ${d.name || 'the booking'}.`);
    } catch (e) { btn.disabled = false; toast(saveError(e, 'booking')); }
  }

  function openLehenga(id){
    const existing = id && lehengaById(id);
    let d;
    if (existing) d = Object.assign({}, existing);
    else {
      d = { id: null, code: '', title: '', rent: '', deposit: '', colour: '', size: '', photoPath: null, createdAt: new Date().toISOString() };
    }
    peek = { type: 'lehenga', draft: d };
    openPeek(lehengaPeekHtml(d), existing ? `Lehenga: ${d.title}` : 'New lehenga');
  }

  function lehengaPeekHtml(d){
    const saved = !!d.id;
    const m = nightMap();
    const ranges = saved ? bookedRanges(d.id, m) : [];
    const bks = saved ? state.bookings.filter(b => b.lehengaId === d.id).sort((a, b) => a.from < b.from ? -1 : 1) : [];
    const conf = bks.filter(b => statusOf(b) === 'Confirmed');
    const earned = conf.reduce((s, b) => s + rentOf(b), 0);
    const colourOptions = `<option value="">—</option>` + Object.keys(COLOURS).map(c => `<option${c === d.colour ? ' selected' : ''}>${c}</option>`).join('');
    const sizeOptions = `<option value="">—</option>` + SIZES.map(s => `<option${s === d.size ? ' selected' : ''}>${s}</option>`).join('');
    return `
      <div class="peek-head"><span class="crumb">Lehengas / ${saved ? esc(d.code || d.title) : 'New lehenga'}</span><button class="icon-btn" data-action="close" aria-label="Close">✕</button></div>
      <div class="peek-body">
        <div class="ph big" id="lh-ph">${photoHtml(d)}</div>
        <div class="ph-actions">
          <label class="btn" for="lh-photo" id="lh-photo-label">${d.photoPath ? 'Change photo' : 'Add photo'}</label>
          <input id="lh-photo" class="sr" type="file" accept="image/*">
          <span class="muted small" id="lh-photo-note"></span>
        </div>
        <label class="sr" for="lh-title">Lehenga title</label>
        <input id="lh-title" class="title-input" placeholder="Lehenga title" value="${esc(d.title)}" autocomplete="off" data-autofocus>
        <p class="field-err" id="lh-err" hidden></p>
        <div class="props">
          <div class="k"><label for="lh-code">Code</label></div>
          <div class="v"><input id="lh-code" class="f mono f-num" value="${esc(d.code)}" autocomplete="off"></div>
          <div class="k"><label for="lh-rent">Rent per night</label></div>
          <div class="v"><span class="rs">₹</span><input id="lh-rent" class="f f-num" type="number" min="0" step="50" inputmode="numeric" value="${esc(d.rent)}" placeholder="0"></div>
          <div class="k"><label for="lh-deposit">Deposit</label></div>
          <div class="v"><span class="rs">₹</span><input id="lh-deposit" class="f f-num" type="number" min="0" step="100" inputmode="numeric" value="${esc(d.deposit)}" placeholder="0"></div>
          <div class="k"><label for="lh-colour">Colour</label></div>
          <div class="v"><select id="lh-colour" class="f f-sm">${colourOptions}</select></div>
          <div class="k"><label for="lh-size">Size</label></div>
          <div class="v"><select id="lh-size" class="f f-sm">${sizeOptions}</select></div>
        </div>
        ${saved ? `
        <div class="divider"></div>
        <div class="props">
          <div class="k">Booked nights <span class="auto-tag">auto</span></div>
          <div class="v">${ranges.length ? ranges.map(x => `<span class="nchip">${rangeShort(x.from, x.to)}</span>`).join('') : '<span class="free-all">No bookings yet</span>'}</div>
          <div class="k">Times booked <span class="auto-tag">auto</span></div>
          <div class="v num">${conf.length}</div>
          <div class="k">Rent earned <span class="auto-tag">auto</span></div>
          <div class="v"><b class="num">${inr(earned)}</b></div>
        </div>
        <div class="peek-book"><button class="btn primary" data-action="book" data-lehenga="${d.id}">${CAL} Book this lehenga</button></div>
        <h3 class="h3">Bookings</h3>
        ${bks.length ? `<div class="mini">${bks.map(b => `<button class="mini-row" data-action="open-booking" data-id="${b.id}"><b>${esc(b.name || 'Untitled')}</b><span class="when">${dateRange(b)}</span>${pill(statusOf(b))}</button>`).join('')}</div>` : '<p class="muted small">No bookings yet.</p>'}
        ` : ''}
      </div>
      <div class="peek-foot">
        <button class="btn primary" data-action="save-lehenga">Save lehenga</button>
        <button class="btn" data-action="close">Discard</button>
        ${saved && !bks.length ? `<button class="btn danger" data-action="delete-lehenga">Delete</button>` : ''}
        ${saved && bks.length ? `<span class="note">Has bookings, so it can't be deleted.</span>` : ''}
      </div>`;
  }

  function readLehengaForm(){
    const d = peek.draft;
    d.title = $('#lh-title').value;
    d.code = $('#lh-code').value.trim();
    d.rent = $('#lh-rent').value;
    d.deposit = $('#lh-deposit').value;
    d.colour = $('#lh-colour').value;
    d.size = $('#lh-size').value;
  }

  async function saveLehenga(btn){
    readLehengaForm();
    const d = peek.draft;
    const err = $('#lh-err');
    const rent = Number(d.rent), deposit = Number(d.deposit);
    if (!d.title.trim()) { err.textContent = 'Add a title to save this lehenga.'; err.hidden = false; $('#lh-title').focus(); return; }
    if (!(rent > 0)) { err.textContent = 'Set the rent per night.'; err.hidden = false; $('#lh-rent').focus(); return; }
    if (!requireStore()) return;
    const body = {
      title: d.title.trim(), code: d.code, rent, deposit: deposit > 0 ? deposit : 0,
      colour: d.colour, size: d.size, photoPath: d.photoPath || null, createdAt: d.createdAt
    };
    btn.disabled = true;
    try {
      const row = lehengaToRow(body);
      const res = d.id ? await sb.from('lehengas').update(row).eq('id', d.id)
                       : await sb.from('lehengas').insert(row);
      if (res.error) throw res.error;
      await loadAll();
      closePeek();
      toast(`Saved ${body.code ? body.code + ' · ' : ''}${body.title}.`);
    } catch (e) { btn.disabled = false; toast(saveError(e, 'lehenga')); }
  }

  async function deleteLehenga(btn){
    if (!requireStore()) return;
    const d = peek.draft;
    btn.disabled = true;
    try {
      const res = await sb.from('lehengas').delete().eq('id', d.id);
      if (res.error) throw res.error;
      await loadAll();
      closePeek();
      toast(`Deleted ${d.code || d.title}.`);
    } catch (e) { btn.disabled = false; toast(saveError(e, 'lehenga')); }
  }

  // Photos: shrink and convert to JPEG in the browser, so iPhone HEIC files work too.
  function shrinkToJpeg(file, maxSide){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('decode'));
        img.onload = () => {
          const s = Math.min(1, maxSide / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * s));
          c.height = Math.max(1, Math.round(img.height * s));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          c.toBlob(b => b ? resolve(b) : reject(new Error('encode')), 'image/jpeg', 0.85);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function handlePhoto(file){
    if (!file || !peek || peek.type !== 'lehenga') return;
    const note = $('#lh-photo-note');
    if (!requireStore()) return;
    if (note) note.textContent = 'Uploading…';
    try {
      const blob = await shrinkToJpeg(file, 1200);
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const { error } = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' });
      if (error) throw error;
      peek.draft.photoPath = path;
      $('#lh-ph').innerHTML = `<img src="${photoSrc(peek.draft)}" alt="">`;
      $('#lh-photo-label').textContent = 'Change photo';
      if (note) note.textContent = 'Added. Press Save lehenga to keep it.';
    } catch (e) {
      if (note) note.textContent = 'Could not upload that photo. Try another one.';
    }
  }

  function saveFile(filename, text, type){
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function exportCsv(){
    const rows = [['Customer','Phone','Lehenga code','Lehenga','First night','Last night','Nights','Return due','Payment','Advance','Discount','Rent','Deposit','Balance due','Status','Deposit status','Returned','Created']];
    state.bookings.slice().sort((a, b) => a.from < b.from ? -1 : 1).forEach(b => {
      const l = lehengaById(b.lehengaId) || { code: '', title: '' };
      rows.push([b.name, b.phone, l.code, l.title, b.from, b.to, nightsOf(b), returnDue(b), b.payment,
        b.advance || 0, b.discount || 0, rentOf(b), depositOf(b), balanceOf(b), statusOf(b),
        b.depositStatus, b.returned ? 'yes' : 'no', b.createdAt]);
    });
    const csv = rows.map(r => r.map(v => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\n');
    saveFile(`ghaghra-gali-bookings-${TODAY}.csv`, csv, 'text/csv');
  }

  /* ---------- backup ---------- */
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function backupPayload(){
    return {
      app: 'ghaghra-gali', version: 1, exportedAt: new Date().toISOString(),
      lehengas: state.lehengas.map(l => Object.assign({}, l)),
      bookings: state.bookings.map(b => Object.assign({}, b))
    };
  }

  async function exportBackup(){
    saveFile(`ghaghra-gali-backup-${TODAY}.json`, JSON.stringify(backupPayload(), null, 1), 'application/json');
    try { localStorage.setItem(BACKUP_KEY, new Date().toISOString()); } catch (e) {}
    renderBackup();
    toast(`Backup saved: ${plural(state.lehengas.length, 'lehenga')}, ${plural(state.bookings.length, 'booking')}.`);
  }

  let pendingImport = null;
  function readBackupFile(file){
    const r = new FileReader();
    r.onerror = () => toast('Could not read that file.');
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (!Array.isArray(data.lehengas) || !Array.isArray(data.bookings)) throw new Error('shape');
        pendingImport = { lehengas: data.lehengas, bookings: data.bookings, exportedAt: data.exportedAt };
      } catch (e) {
        pendingImport = null;
        toast('That file is not a Ghaghra Gali backup.');
      }
      renderBackup();
    };
    r.readAsText(file);
  }

  const withTimeout = (promise, ms, label) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject({ code: 'timeout', message: label }), ms))
  ]);

  async function runImport(btn){
    if (!pendingImport || !requireStore()) return;
    btn.disabled = true;
    btn.textContent = 'Restoring…';
    let done = 0, failed = 0;
    const restore = async (table, row) => {
      try {
        const { error } = await withTimeout(sb.from(table).upsert(row), 15000, 'slow connection');
        error ? failed++ : done++;
      } catch (e) { failed++; }
    };
    for (const l of pendingImport.lehengas) await restore('lehengas', Object.assign({ id: l.id }, lehengaToRow(l)));
    for (const b of pendingImport.bookings) await restore('bookings', Object.assign({ id: b.id }, bookingToRow(b)));
    pendingImport = null;
    await loadAll();
    btn.disabled = false;
    btn.textContent = 'Restore';
    renderBackup();
    toast(failed
      ? `Restored ${done} rows. ${failed} could not be written — they may be from an older version of the app.`
      : `Restored ${done} rows from the backup.`);
  }

  function renderBackup(){
    const status = $('#backup-status');
    let last = null;
    try { last = localStorage.getItem(BACKUP_KEY); } catch (e) {}
    if (!last) status.textContent = 'No backup taken on this device yet.';
    else {
      const days = diffDays(last.slice(0, 10), TODAY);
      status.textContent = days <= 0 ? 'Last backup: today.'
        : days === 1 ? 'Last backup: yesterday.'
        : `Last backup: ${days} days ago.`;
      status.className = days > 1 ? 'sec-sub warnish' : 'sec-sub';
    }
    const box = $('#import-confirm');
    if (!pendingImport) { box.hidden = true; box.innerHTML = ''; return; }
    const when = pendingImport.exportedAt ? fmtCreated(pendingImport.exportedAt.slice(0, 10)) : 'an unknown date';
    box.hidden = false;
    box.innerHTML = `<div class="warn-box" style="margin:0">
      <strong>Restore this backup?</strong> It holds ${plural(pendingImport.lehengas.length, 'lehenga')} and
      ${plural(pendingImport.bookings.length, 'booking')}, saved ${esc(when)}.
      Rows in the backup are written back; anything added since then stays as it is.
      <div class="ph-actions" style="margin-top:10px">
        <button class="btn primary" data-action="import-run">Restore</button>
        <button class="btn" data-action="import-cancel">Cancel</button>
      </div>
    </div>`;
  }

  let toastTimer = null;
  function toast(msg){
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
  }

  /* ---------- events ---------- */
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const a = t.dataset.action;
    if (a === 'book') openBooking(null, { lehengaId: t.dataset.lehenga });
    else if (a === 'cell-free') openBooking(null, { lehengaId: t.dataset.lehenga, date: t.dataset.date });
    else if (a === 'open-booking') openBooking(t.dataset.id);
    else if (a === 'open-lehenga') openLehenga(t.dataset.id);
    else if (a === 'new-booking') openBooking(null, {});
    else if (a === 'new-lehenga') openLehenga(null);
    else if (a === 'close') closePeek();
    else if (a === 'save-booking') saveBooking(t);
    else if (a === 'delete-booking') askDelete('booking');
    else if (a === 'delete-booking-now') deleteBooking(t);
    else if (a === 'delete-cancel') cancelDelete();
    else if (a === 'save-lehenga') saveLehenga(t);
    else if (a === 'delete-lehenga') askDelete('lehenga');
    else if (a === 'delete-lehenga-now') deleteLehenga(t);
    else if (a === 'tab') { ui.tab = t.dataset.tab; saveUi(); renderBookings(); }
    else if (a === 'grid-prev') shiftWindow(-7);
    else if (a === 'grid-next') shiftWindow(7);
    else if (a === 'grid-today') { ui.windowStart = addDays(TODAY, -2); saveUi(); renderGrid(); }
    else if (a === 'grid-navratri') { ui.windowStart = addDays(NAVRATRI_START, -2); saveUi(); renderGrid(); scrollGridTo(NAVRATRI_START, true); }
    else if (a === 'free-on-clear') { ui.freeOn = ''; saveUi(); renderGallery(); }
    else if (a === 'sign-in') signIn(t);
    else if (a === 'sign-out') signOut();
    else if (a === 'export') exportCsv();
    else if (a === 'export-backup') exportBackup();
    else if (a === 'import-run') runImport(t);
    else if (a === 'import-cancel') { pendingImport = null; renderBackup(); }
  });

  // Ticking "returned" in the Today panel writes straight through
  $('#panel-back').addEventListener('change', async e => {
    const id = e.target.dataset.return;
    if (!id) return;
    const b = state.bookings.find(x => x.id === id);
    if (!b) return;
    const checked = e.target.checked;
    if (!requireStore()) { e.target.checked = !checked; return; }
    try {
      const res = await sb.from('bookings').update({ returned: checked }).eq('id', id);
      if (res.error) throw res.error;
      await loadAll();
      const l = lehengaById(b.lehengaId) || {};
      toast(checked ? `${l.code || l.title} is back from ${firstName(b.name)}.` : `${l.code || l.title} marked as not back yet.`);
    } catch (err) {
      e.target.checked = !checked;
      toast(saveError(err, 'booking'));
    }
  });

  $('#peek').addEventListener('input', e => {
    if (!peek) return;
    if (peek.type === 'booking') {
      if (e.target.id === 'bk-name') $('#bk-err').hidden = true;
      readBookingForm(); updateBookingDerived();
    } else if (peek.type === 'lehenga' && e.target.id !== 'lh-photo') {
      $('#lh-err').hidden = true;
      readLehengaForm();
    }
  });
  $('#peek').addEventListener('change', e => {
    if (!peek) return;
    if (e.target.id === 'lh-photo') { handlePhoto(e.target.files && e.target.files[0]); return; }
    if (peek.type === 'booking') { readBookingForm(); updateBookingDerived(); }
    else if (peek.type === 'lehenga') readLehengaForm();
  });
  $('#free-on').addEventListener('change', e => {
    ui.freeOn = isValidIso(e.target.value) ? e.target.value : '';
    saveUi(); renderGallery();
  });
  $('#import-file').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) readBackupFile(f);
  });
  $('#today-pick').addEventListener('change', e => {
    if (!isValidIso(e.target.value)) return;
    ui.today = e.target.value;
    render();
    scrollGridTo(ui.today, true);
  });
  $('#login-form').addEventListener('submit', e => {
    e.preventDefault();
    signIn($('#login-form').querySelector('[data-action="sign-in"]'));
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && peek) closePeek();
    if (e.key === 'Enter' && peek && peek.type === 'booking' && e.target.id === 'bk-name') { e.preventDefault(); $('#bk-lehenga').focus(); }
  });

  render();
  renderStoreNote();
  renderBackup();
  connect();
})();
