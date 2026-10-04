/* ERM 2026 · datos abiertos. Sin dependencias. */
(() => {
  'use strict';
  const DATA = 'data/';
  const POLL_MS = 60_000;
  const TZ = 'America/Lima';
  const CLOSE = Date.parse('2026-10-04T17:00:00-05:00');
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = new Intl.NumberFormat('es-PE');
  const n = (v) => (v === null || v === undefined || v === '' ? '—' : fmt.format(v));
  const pct = (v, d = 2) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(d)}%`);
  const time = (ms, withDate) => (ms ? new Date(ms).toLocaleString('es-PE', { timeZone: TZ, hour: 'numeric', minute: '2-digit', ...(withDate ? { day: 'numeric', month: 'short' } : {}) }) : '—');
  const ago = (ms) => { if (!ms) return '—'; const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'hace segundos' : m < 60 ? `hace ${m} min` : `hace ${Math.floor(m / 60)} h ${m % 60} min`; };
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/^EL\s+/, '').trim();
  const title = (s) => String(s || '').toLowerCase().replace(/(^|[\s/(-])([a-záéíóúñü])/g, (m, a, b) => a + b.toUpperCase());

  const PALETTE = ['#2457c5', '#c8102e', '#1a7f4b', '#a8640a', '#7b3fb8', '#0f8a9d', '#c2410c', '#4d7c0f', '#be185d', '#475569', '#0e7490', '#9a3412'];
  const colorFor = (code, name) => { const k = String(code ?? name ?? ''); let h = 0; for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };

  const state = { cfg: {}, status: null, latest: null, checks: null, sch: null, feed: null, eid: null, scope: 'nacional', geo: null, ambitos: {}, showAll: false, pages: {}, lowerQuery: '', lowerEid: null, chartEid: null, feedAgent: '' };

  async function get(path, type = 'json') {
    const r = await fetch(DATA + path + '?t=' + Math.floor(Date.now() / 30000), { cache: 'no-store' });
    if (!r.ok) throw new Error(path + ' ' + r.status);
    return type === 'text' ? r.text() : r.json();
  }
  const tryGet = (p, t) => get(p, t).catch(() => null);

  /* ---------------- navegación por pestañas (sin scroll infinito) ---------------- */
  const VIEWS = ['oficina', 'resultados', 'distrito', 'avance', 'verificaciones', 'mercados', 'evidencia', 'datos', 'nosotros'];
  function showView() {
    const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'oficina';
    for (const x of VIEWS) $('#v-' + x).classList.toggle('hidden', x !== v);
    document.querySelectorAll('#viewnav a').forEach((a) => a.setAttribute('aria-current', a.dataset.v === v ? 'page' : 'false'));
    $('#viewnav a[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    window.scrollTo({ top: 0 });
  }
  window.addEventListener('hashchange', showView);

  /* paginador genérico */
  function pager(id, total, size, onPage) {
    const pages = Math.max(1, Math.ceil(total / size));
    const p = Math.min(state.pages[id] || 1, pages);
    state.pages[id] = p;
    const el = $('#' + id);
    if (pages <= 1) { el.innerHTML = ''; return [0, total]; }
    el.innerHTML = `<button ${p <= 1 ? 'disabled' : ''} data-p="${p - 1}">← Anterior</button><span>Página ${p} de ${pages}</span><button ${p >= pages ? 'disabled' : ''} data-p="${p + 1}">Siguiente →</button>`;
    el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { state.pages[id] = +b.dataset.p; onPage(); }));
    return [(p - 1) * size, p * size];
  }

  /* ---------------- tema ---------------- */
  $('#theme').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('erm-theme', next); } catch (e) { /* sin storage */ }
  });

  /* ---------------- estado + frase resumen ---------------- */
  const isLive = () => state.status?.estado === 'en-vivo' && state.latest?.elecciones?.length;

  function renderStatus() {
    const s = state.status || {};
    const live = isLive();
    $('#status').className = 'pill ' + (live ? 'live' : (s.estado === 'error' || s.estado === 'bloqueado') ? 'err' : 'wait');
    $('#statusText').textContent = live ? 'En vivo' : s.estado === 'bloqueado' ? 'ONPE no responde' : s.estado === 'error' ? 'Sin conexión' : 'Esperando a la ONPE';
    $('#footTimes').textContent = `Última consulta a la ONPE: ${s.consultado ? ago(Date.parse(s.consultado)) : '—'}`;
    $('#waiting').classList.toggle('hidden', !!live);
    $('#live').classList.toggle('hidden', !live);
    if (!live && s.detalle) $('#waitDetail').textContent = s.detalle + ' Aquí no se muestran estimaciones: solo cifras oficiales.';
    renderHeadline();
  }

  function renderHeadline() {
    const s = state.status || {};
    if (!isLive()) {
      const closed = Date.now() >= CLOSE;
      $('#hlMain').innerHTML = closed ? 'La votación terminó. <span class="muted">Esperando los primeros resultados oficiales de la ONPE.</span>' : 'Hoy se vota. <span class="muted">Todavía no hay resultados oficiales.</span>';
      $('#hlSub').textContent = s.estado === 'bloqueado' ? 'La ONPE no está respondiendo a consultas automáticas. Apenas responda, este tablero se actualiza solo.' : `Revisamos la ONPE cada 2 minutos. Última revisión: ${s.consultado ? ago(Date.parse(s.consultado)) : '—'}.`;
      return;
    }
    const e = current();
    const t = e.totales || {};
    const lead = (e.participantes || []).find((p) => p.votos);
    $('#hlMain').innerHTML = `Se contó el <b class="num">${pct(t.actasContabilizadas, 1)}</b> de las actas de <b>${esc(e.menu || e.nombre)}</b>.`;
    $('#hlSub').innerHTML = `${lead ? `En todo el país, la organización con más votos es ${esc(title(lead.partido))} (${pct(lead.pctValidos, 1)}). ` : ''}Cada región y cada municipio eligen por separado: toca tu región en el mapa. Actualización oficial de las ${time(t.fechaActualizacion)}.`;
  }

  function renderCountdown() {
    const left = CLOSE - Date.now();
    if (left <= 0) { $('#countdown').innerHTML = ''; $('#countLabel').textContent = 'La votación ya cerró. Los resultados aparecen aquí apenas la ONPE los publique.'; return; }
    const h = Math.floor(left / 3.6e6), m = Math.floor((left % 3.6e6) / 6e4), s = Math.floor((left % 6e4) / 1e3);
    $('#countdown').innerHTML = [[h, 'horas'], [m, 'minutos'], [s, 'segundos']].map(([v, l]) => `<div><b>${String(v).padStart(2, '0')}</b><span>${l}</span></div>`).join('');
  }

  function renderDay() {
    const items = [['6:00 a. m.', '06:00', 'Se instalan las mesas'], ['7:00 a. m.', '07:00', 'Empieza la votación'], ['5:00 p. m.', '17:00', 'Termina la votación y se cuentan los votos en cada mesa'], ['Después', '17:30', 'La ONPE publica resultados a medida que llegan las actas']];
    const now = Date.now();
    $('#dayline').innerHTML = items.map(([lbl, h, t], i) => {
      const at = Date.parse(`2026-10-04T${h}:00-05:00`);
      const next = items[i + 1] ? Date.parse(`2026-10-04T${items[i + 1][1]}:00-05:00`) : Infinity;
      const cls = now >= next ? 'past' : now >= at ? 'now' : '';
      return `<li class="${cls}"><span class="h">${lbl}</span><span>${esc(t)}${cls === 'now' ? ' <b class="nowtag">ahora</b>' : ''}</span></li>`;
    }).join('');
  }

  /* ---------------- 1. resultados ---------------- */
  const current = () => (state.latest?.elecciones || []).find((e) => e.id === state.eid) || (state.latest?.elecciones || [])[0];

  function renderTabs() {
    const els = state.latest?.elecciones || [];
    if (!els.find((e) => e.id === state.eid)) state.eid = els[0]?.id;
    $('#tabs').innerHTML = els.map((e) => `<button class="tab" role="tab" aria-selected="${e.id === state.eid}" data-id="${e.id}">${esc(e.menu || e.nombre)}</button>`).join('');
    $('#tabs').querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { state.eid = +b.dataset.id; state.scope = 'nacional'; state.showAll = false; renderResults(); }));
  }

  function renderKpis(t) {
    t = t || {};
    const cards = [
      ['Actas contadas', pct(t.actasContabilizadas, 1), `${n(t.contabilizadas)} de ${n(t.totalActas)} actas`, t.actasContabilizadas],
      ['Fueron a votar', pct(t.participacionCiudadana, 1), 'de los electores', t.participacionCiudadana],
      ['Votos válidos', n(t.totalVotosValidos), `de ${n(t.totalVotosEmitidos)} votos emitidos`],
      ['Actas en revisión (JEE)', n(t.enviadasJee), 'las revisa el Jurado Electoral'],
    ];
    $('#kpis').innerHTML = cards.map(([l, v, s, b]) => `<div class="card kpi"><div class="lbl">${l}</div><div class="val num">${v}</div><div class="sub">${s}</div>${b !== undefined ? `<div class="bar"><i style="width:${Math.min(100, +b || 0)}%"></i></div>` : ''}</div>`).join('');
  }

  function scopeData(e) {
    const d = state.scope !== 'nacional' && (e.departamentos || []).find((x) => x.ubigeo === state.scope);
    return d ? { name: title(d.nombre), t: d.totales, p: d.participantes } : { name: 'Todo el país', t: e.totales, p: e.participantes, national: true };
  }

  function renderRank(e) {
    const sd = scopeData(e);
    $('#scopeTitle').textContent = sd.name;
    const sel = $('#scope');
    sel.innerHTML = `<option value="nacional">Todo el país</option>` + (e.departamentos || []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map((d) => `<option value="${esc(d.ubigeo)}">${esc(title(d.nombre))}</option>`).join('');
    sel.value = state.scope;
    const t = sd.t || {};
    $('#scopeChips').innerHTML = [`${pct(t.actasContabilizadas, 1)} de actas contadas`, t.fechaActualizacion ? `Actualizado ${time(t.fechaActualizacion)}` : null].filter(Boolean).map((c) => `<span class="chip">${esc(c)}</span>`).join('')
      + (sd.national ? `<p class="small muted" style="margin:8px 0 0;width:100%">Este total suma los votos de todo el país por organización. Para ver quién gana en tu región, elígela en el mapa o en la lista.</p>` : '');
    const rows = (sd.p || []).filter((p) => p.votos !== null && p.votos !== undefined);
    const LIMIT = 5;
    const shown = state.showAll ? rows : rows.slice(0, LIMIT);
    const max = Math.max(1, ...rows.map((p) => p.votos || 0));
    $('#rank').innerHTML = shown.length ? shown.map((p, i) => {
      const col = colorFor(p.codPartido, p.partido);
      const who = p.candidato && !sd.national
        ? `<b>${esc(title(p.candidato))}</b><span>${esc(title(p.partido))} · <a class="cv" href="https://votoinformado.jne.gob.pe/" target="_blank" rel="noopener">hoja de vida ↗</a></span>`
        : `<b>${esc(title(p.partido))}</b>`;
      return `<li><div class="row"><span class="pos">${i + 1}</span><div class="who">${who}</div><div class="right"><div class="pct">${pct(p.pctValidos, 1)}</div><div class="votes num">${n(p.votos)} votos</div></div></div><div class="bar"><i style="width:${(100 * (p.votos || 0)) / max}%;background:${col}"></i></div></li>`;
    }).join('') : `<li class="empty">Todavía no hay votos publicados aquí.</li>`;
    const more = $('#rankMore');
    more.classList.toggle('hidden', rows.length <= LIMIT);
    more.textContent = state.showAll ? 'Ver solo los 5 primeros' : `Ver los ${rows.length} candidatos`;
  }
  $('#rankMore').addEventListener('click', () => { state.showAll = !state.showAll; renderRank(current()); });

  function renderMap(e) {
    if (!state.geo) { $('#map').innerHTML = '<div class="skeleton" style="height:320px"></div>'; return; }
    const byName = {};
    for (const d of e.departamentos || []) byName[norm(d.nombre)] = d;
    const W = 420, H = 560, lon0 = -81.4, lon1 = -68.6, lat0 = 0.1, k = Math.cos((9 * Math.PI) / 180);
    const s = Math.min(W / ((lon1 - lon0) * k), H / 18.5);
    const P = ([x, y]) => `${((x - lon0) * k * s).toFixed(1)},${((lat0 - y) * s).toFixed(1)}`;
    const ring = (r) => 'M' + r.map(P).join('L') + 'Z';
    const legend = new Map();
    const paths = state.geo.features.map((f) => {
      const g = f.geometry, rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
      const name = f.properties.name;
      if (/titicaca/i.test(name)) return `<path d="${rings.map(ring).join('')}" fill="var(--info-soft)" style="cursor:default"></path>`;
      const d = byName[norm(name)];
      let fill = 'var(--surface-2)', tip = `${name}: sin datos todavía`;
      const lead = d?.participantes?.find((p) => p.votos);
      if (lead) {
        fill = colorFor(lead.codPartido, lead.partido);
        legend.set(title(lead.partido), fill);
        tip = `${title(d.nombre)}: va primero ${lead.candidato ? title(lead.candidato) + ', ' : ''}${title(lead.partido)} con ${pct(lead.pctValidos, 1)} (${pct(d.totales?.actasContabilizadas, 1)} de actas contadas)`;
      }
      return `<path d="${rings.map(ring).join('')}" fill="${fill}" data-u="${esc(d?.ubigeo || '')}" class="${d && d.ubigeo === state.scope ? 'sel' : ''}"><title>${esc(tip)}</title></path>`;
    }).join('');
    $('#map').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Mapa del Perú por región">${paths}</svg>`;
    $('#map').querySelectorAll('path[data-u]').forEach((p) => p.addEventListener('click', () => { if (p.dataset.u) { state.scope = p.dataset.u; state.showAll = false; renderResults(); } }));
    $('#legend').innerHTML = legend.size ? '<span class="muted">Color = quién va primero en esa región:</span>' + [...legend].map(([k2, c]) => `<span><i style="background:${c}"></i>${esc(k2)}</span>`).join('') : '';
  }
  $('#toNational').addEventListener('click', () => { state.scope = 'nacional'; state.showAll = false; renderResults(); });
  $('#scope').addEventListener('change', (ev) => { state.scope = ev.target.value; state.showAll = false; renderResults(); });

  function renderResults() {
    const e = current();
    if (!e) return;
    renderTabs();
    renderKpis(e.totales);
    renderMap(e);
    renderRank(e);
    renderHeadline();
  }

  /* ---------------- 2. busca tu zona ---------------- */
  function fillElectionSelect(id, filter, key) {
    const els = (state.latest?.elecciones || []).filter(filter);
    const sel = $(id);
    if (!els.find((e) => e.id === state[key])) state[key] = els[0]?.id;
    sel.innerHTML = els.map((e) => `<option value="${e.id}">${esc(e.menu || e.nombre)}</option>`).join('');
    sel.classList.toggle('hidden', !els.length);
    sel.value = state[key] ?? '';
    return els.find((e) => e.id === state[key]);
  }

  async function renderLower() {
    const e = fillElectionSelect('#lowerElection', (x) => x.nivel >= 2, 'lowerEid');
    if (!e) {
      $('#lowerTable').innerHTML = `<tbody><tr><td class="empty">${isLive() ? 'Esta sección es para las elecciones de alcaldes.' : 'Aquí podrás buscar tu provincia o distrito cuando la ONPE publique resultados.'}</td></tr></tbody>`;
      $('#lowerPager').innerHTML = ''; $('#lowerNote').textContent = '';
      return;
    }
    const a = state.ambitos[e.id] || (state.ambitos[e.id] = await tryGet(`ambitos/eleccion-${e.id}.json`));
    const q = norm(state.lowerQuery);
    const rows = Object.values({ ...(a?.provincias || {}), ...(a?.distritos || {}) }).filter((r) => !q || norm(r.nombre).includes(q)).sort((x, y) => x.nombre.localeCompare(y.nombre));
    const [i0, i1] = pager('lowerPager', rows.length, 15, renderLower);
    $('#lowerTable').innerHTML = `<thead><tr><th>Lugar</th><th>Va primero</th><th class="n">%</th><th class="n">Actas contadas</th></tr></thead><tbody>` +
      (rows.slice(i0, i1).map((r) => { const l = (r.participantes || [])[0] || {}; return `<tr><td>${esc(title(r.nombre))}</td><td>${esc(title(l.candidato || ''))}<div class="small muted">${esc(title(l.partido || '—'))}</div></td><td class="n num">${pct(l.pctValidos, 1)}</td><td class="n num">${pct(r.totales?.actasContabilizadas, 1)}</td></tr>`; }).join('') || `<tr><td colspan="4" class="empty">${q ? 'No encontramos ese nombre. Prueba escribiéndolo de otra forma.' : 'Todavía estamos descargando provincias y distritos.'}</td></tr>`) + '</tbody>';
    $('#lowerNote').textContent = a ? `Tenemos ${n(Object.keys(a.provincias || {}).length)} provincias y ${n(Object.keys(a.distritos || {}).length)} distritos. ${a.pendientes ? `Faltan ${n(a.pendientes)}: los pedimos de a pocos para no saturar a la ONPE.` : ''}` : '';
  }
  $('#lowerElection').addEventListener('change', (ev) => { state.lowerEid = +ev.target.value; state.pages.lowerPager = 1; renderLower(); });
  $('#lowerSearch').addEventListener('input', (ev) => { state.lowerQuery = ev.target.value; state.pages.lowerPager = 1; renderLower(); });

  /* ---------------- 3. avance ---------------- */
  async function renderChart() {
    const e = fillElectionSelect('#chartElection', () => true, 'chartEid');
    if (!e) { $('#chart').innerHTML = '<div class="empty">El gráfico aparece cuando la ONPE publique su primera actualización.</div>'; return; }
    const csv = await tryGet(`series/eleccion-${e.id}.csv`, 'text');
    const rows = (csv || '').trim().split('\n').slice(1).map((l) => l.split(',')).filter((r) => r[0]).map((r) => ({ t: +r[0], v: +r[2] }));
    if (rows.length < 2) { $('#chart').innerHTML = '<div class="empty">El gráfico aparece desde la segunda actualización de la ONPE.</div>'; return; }
    const W = 800, H = 240, L = 44, B = 26, T = 10, R = 12;
    const t0 = rows[0].t, t1 = rows[rows.length - 1].t;
    const X = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R), Y = (v) => T + (1 - v / 100) * (H - T - B);
    const pts = rows.map((r) => `${X(r.t).toFixed(1)},${Y(r.v).toFixed(1)}`);
    const grid = [0, 25, 50, 75, 100].map((v) => `<line class="axis" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="lbl" x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${v}%</text>`).join('');
    const ticks = [rows[0], rows[Math.floor(rows.length / 2)], rows[rows.length - 1]].map((r) => `<text class="lbl" x="${X(r.t)}" y="${H - 6}" text-anchor="middle">${time(r.t)}</text>`).join('');
    const last = rows[rows.length - 1];
    $('#chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}<path class="area" d="M${X(t0)},${Y(0)}L${pts.join('L')}L${X(t1)},${Y(0)}Z"/><polyline class="line" points="${pts.join(' ')}"/>${ticks}</svg><p class="small muted" style="margin:6px 0 0">Van ${pct(last.v, 1)} de actas contadas (${time(t1)}), en ${n(rows.length)} actualizaciones. <a href="${DATA}series/eleccion-${e.id}.csv" download>Descargar en Excel (CSV)</a></p>`;
  }
  $('#chartElection').addEventListener('change', (ev) => { state.chartEid = +ev.target.value; renderChart(); });

  /* ---------------- 4. verificaciones ---------------- */
  function renderChecks() {
    const live = isLive();
    const items = state.checks?.items || [];
    const v = $('#verdict');
    if (!live) { v.className = 'verdict wait'; v.innerHTML = '<b>Todavía no hay nada que revisar.</b> Las revisiones empiezan con la primera actualización de la ONPE.'; $('#checks').innerHTML = ''; $('#checksPager').innerHTML = ''; return; }
    const alerts = items.filter((x) => x.severidad === 'alerta').length;
    v.className = 'verdict ' + (items.length ? (alerts ? 'bad' : 'warn') : 'ok');
    v.innerHTML = items.length ? `<b>${n(items.length)} diferencia${items.length > 1 ? 's' : ''} para revisar</b> en la última actualización${alerts ? ` (${alerts} importante${alerts > 1 ? 's' : ''})` : ''}. Están abajo, con los números de cada lado.` : '<b>✔ Todo cuadra.</b> En la última actualización, las sumas, los porcentajes y los acumulados de la ONPE coinciden.';
    const [i0, i1] = pager('checksPager', items.length, 8, renderChecks);
    $('#checks').innerHTML = items.slice(i0, i1).map((x) => `<li class="check"><span class="badge ${esc(x.severidad)}">${x.severidad === 'alerta' ? 'Importante' : 'Revisar'}</span><div><b class="small">${esc(x.ambito)}</b><div>${esc(x.detalle)}</div></div></li>`).join('');
  }

  /* ---------------- 1. oficina en vivo ---------------- */
  const LABEL = { activo: ['ok', 'Trabajando ahora'], cumpliendo: ['ok', 'Al día'], atrasado: ['alerta', 'Atrasado'], programado: ['info', 'Aún no entra'], 'fuera-de-horario': ['info', 'Terminó su turno'] };
  const TIPO = { publica: 'publicó', trabaja: 'trabajó en', recibe: 'recibió un encargo' };
  function linkify(t) {
    let s = esc(t);
    s = s.replace(/\[([^\]]{1,120})\]\((https:\/\/[^\s)]+)\)/g, (m, a, u) => `<a href="${u}" target="_blank" rel="noopener nofollow">${a}</a>`);
    s = s.replace(/(^|[\s(])(https:\/\/[^\s<)]+)/g, (m, p, u) => `${p}<a href="${u}" target="_blank" rel="noopener nofollow">${u.replace(/^https:\/\//, '').slice(0, 40)}</a>`);
    return s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  }
  const feedLine = (x) => `<li><span class="who">${esc(x.agente)}</span>${x.tipo === 'recibe' ? '<span class="tag">encargo de Norma</span>' : ''}<span class="when">${time(Date.parse(x.ts), true)}</span><div class="txt">${linkify(x.texto)}</div></li>`;

  function renderBots() {
    const ag = state.sch?.agentes || [];
    Office.update(ag, state.status?.estado, state.feed?.items);
    $('#agents').innerHTML = ag.length ? ag.map((a, i) => {
      const [cls, lbl] = LABEL[a.estado] || ['info', a.estado];
      return `<button class="card agent ${cls}" data-i="${i}"><div class="head"><h3>${esc(a.agente)} <span class="muted small">· ${esc(a.puesto)}</span></h3><span class="badge ${cls}">${lbl}</span></div><p>${esc(a.rol)}</p><div class="meta">${a.estado === 'programado' ? `Entra a las ${esc(a.inicio)}` : `Último movimiento ${a.ultimaActividad ? ago(Date.parse(a.ultimaActividad)) : '—'}`} · ${n(a.publicaciones)} mensajes</div></button>`;
    }).join('') : '<div class="card empty">El equipo aparece en unos minutos.</div>';
    $('#agents').querySelectorAll('.agent').forEach((b) => b.addEventListener('click', () => openAgent(ag[+b.dataset.i])));
    const ff = $('#feedFilter');
    if (ff.options.length <= 1) ag.forEach((a) => ff.insertAdjacentHTML('beforeend', `<option value="${esc(a.agente)}">${esc(a.agente)} · ${esc(a.puesto)}</option>`));
    renderChat();
    renderStream();
    const pl = state.sch?.plan || [];
    $('#plan').innerHTML = pl.map((p) => `<li><span class="h">${esc(p.hora)}</span><span>${esc(p.que)} <span class="muted small">· ${esc(p.quien.join(', '))}</span></span></li>`).join('');
  }
  $('#feedFilter').addEventListener('change', (ev) => { state.feedAgent = ev.target.value; state.chatKey = null; renderChat(); });

  /* ---------------- transmisión: chat, cintillo, contador ---------------- */
  const STREAM_START = Date.parse('2026-10-04T00:38:00-05:00'); // hora en que se armó el equipo
  const short = (t, max) => { const s = String(t).replace(/\*\*|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim(); return s.length > max ? s.slice(0, max - 1) + '…' : s; };

  function renderChat() {
    const all = (state.feed?.items || []).filter((x) => !state.feedAgent || x.agente === state.feedAgent);
    const items = all.slice(0, 80).reverse();             // el chat se lee de arriba (antiguo) a abajo (nuevo)
    const key = `${state.feedAgent}|${all.length}|${all[0]?.ts}`;
    if (key === state.chatKey) return;
    state.chatKey = key;
    const box = $('#chat');
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    const puesto = Object.fromEntries((state.sch?.agentes || []).map((a) => [a.agente, a.puesto]));
    box.innerHTML = items.length ? items.map((x) => {
      const long = x.texto.length > 260;
      const body = linkify(long ? x.texto.slice(0, 259) + '…' : x.texto);
      return `<li class="msg ${x.tipo}"><span class="t">${time(Date.parse(x.ts))}</span><b style="color:${Office.colorOf(x.agente)}" title="${esc(puesto[x.agente] || '')}">${esc(x.agente)}</b>${x.tipo === 'recibe' ? '<span class="tag">encargo de Norma</span>' : ''} <span class="body">${body}</span>${long ? ` <button class="link more-msg" data-ts="${esc(x.ts)}">ver todo</button>` : ''}</li>`;
    }).join('') : '<li class="empty">Sin mensajes todavía.</li>';
    box.querySelectorAll('.more-msg').forEach((b) => b.addEventListener('click', () => {
      const x = all.find((y) => y.ts === b.dataset.ts);
      if (x) { b.previousElementSibling.innerHTML = linkify(x.texto); b.remove(); }
    }));
    if (atBottom || !state.chatScrolled) { box.scrollTop = box.scrollHeight; state.chatScrolled = true; }
  }

  let ltI = 0;
  function rotateLowerThird() {
    const pubs = (state.feed?.items || []).filter((x) => x.tipo !== 'recibe').slice(0, 5);
    const el = $('#lowerThird');
    if (!pubs.length) { el.innerHTML = ''; return; }
    const x = pubs[ltI++ % pubs.length];
    const a = (state.sch?.agentes || []).find((y) => y.agente === x.agente);
    el.innerHTML = `<div class="lt-name" style="background:${Office.colorOf(x.agente)}">${esc(x.agente)}<small>${esc(a?.puesto || '')} · IA</small></div><div class="lt-text">${esc(short(x.texto, 170))}<span class="lt-time">${ago(Date.parse(x.ts))}</span></div>`;
  }

  function renderStream() {
    const s = state.status || {};
    const ag = state.sch?.agentes || [];
    const working = ag.filter((a) => a.estado === 'activo' || a.estado === 'cumpliendo').length;
    const e = isLive() ? current() : null;
    const r = state.actas;
    const parts = [
      s.estado === 'en-vivo' ? 'ONPE: resultados oficiales publicados' : s.estado === 'bloqueado' ? 'ONPE: el portal no responde a consultas automáticas' : 'ONPE: el portal aún no publica resultados',
      e ? `${esc(e.menu || e.nombre)}: ${pct(e.totales?.actasContabilizadas, 1)} de actas contadas (corte ${time(e.totales?.fechaActualizacion)})` : null,
      r ? `Acta por acta: ${n(r.actasLeidas)} actas revisadas · ${n(r.avisos?.alerta)} alertas · ${n(r.avisos?.revisar)} para revisar` : null,
      state.evStats ? `Evidencias ciudadanas: ${n(state.evStats.recibidos)} recibidas · ${n(state.evStats.verificados)} verificadas` : null,
      `Agentes trabajando: ${working} de ${ag.length}`,
      'Envía evidencia en la pestaña 7 · Datos abiertos en la pestaña 8',
    ].filter(Boolean);
    const txt = parts.map((p) => `<span>${p}</span>`).join('<i>◆</i>');
    $('#crawl').innerHTML = txt + '<i>◆</i>' + txt;          // duplicado para que el desplazamiento no tenga cortes
    $('#streamChips').innerHTML = [`${working} de ${ag.length} agentes trabajando`, `${n(state.feed?.items?.length)} mensajes hoy`, 'Datos: ONPE · Repositorio abierto'].map((c) => `<span class="chip">${esc(c)}</span>`).join('');
  }

  function tickStream() {
    const ms = Math.max(0, Date.now() - STREAM_START);
    const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4), s = Math.floor((ms % 6e4) / 1e3);
    $('#elapsed').textContent = [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
    $('#hudClock').textContent = new Date().toLocaleTimeString('es-PE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' · Lima';
  }

  // Cuántas personas están mirando: cada visitante avisa cada 30 s con un id aleatorio de sesión (sin datos personales).
  let sid = null;
  try { sid = sessionStorage.getItem('erm-sid'); } catch (e) { /* sin storage */ }
  if (!sid) { sid = Math.random().toString(36).slice(2, 12); try { sessionStorage.setItem('erm-sid', sid); } catch (e) { /* sin storage */ } }
  async function ping() {
    const r = await fetch('api/ping?s=' + sid, { method: 'POST', cache: 'no-store' }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    $('#viewers').textContent = r && r.viendo ? `👁 ${n(r.viendo)} viendo` : '👁 —';
  }

  function openAgent(a) {
    if (!a) return;
    const [cls, lbl] = LABEL[a.estado] || ['info', a.estado];
    const mine = (state.feed?.items || []).filter((x) => x.agente === a.agente).slice(0, 5);
    $('#agentBody').innerHTML = `<div class="head" style="display:flex;justify-content:space-between;gap:10px;align-items:center"><h2>${esc(a.agente)}</h2><span class="badge ${cls}">${lbl}</span></div>
      <p class="muted" style="margin:2px 0 10px">${esc(a.puesto)} · agente de IA</p><p>${esc(a.rol)}</p>
      <div class="chips" style="margin:10px 0"><span class="chip">Turno desde las ${esc(a.inicio)}</span><span class="chip">${n(a.publicaciones)} mensajes</span><span class="chip">Último movimiento ${a.ultimaActividad ? ago(Date.parse(a.ultimaActividad)) : '—'}</span></div>
      <h3 style="margin-top:14px">Lo último que hizo</h3><ul class="feed">${mine.map(feedLine).join('') || '<li class="empty">Todavía nada.</li>'}</ul>`;
    const d = $('#agentDlg');
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  }

  // Ticker: el último movimiento del equipo, rotando.
  let tickI = 0;
  function renderTicker() { tickI = 0; rotateTicker(); }
  function rotateTicker() {
    const items = (state.feed?.items || []).filter((x) => x.tipo !== 'recibe').slice(0, 8);
    if (!items.length) { $('#ticker').innerHTML = ''; return; }
    const x = items[tickI++ % items.length];
    const a = (state.sch?.agentes || []).find((y) => y.agente === x.agente);
    const txt = String(x.texto).replace(/\*\*|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ');
    $('#ticker').innerHTML = `<span class="live-dot"></span><b>${esc(x.agente)}</b>${a ? ` <span class="muted">(${esc(a.puesto.toLowerCase())})</span>` : ''} · <span class="muted">${ago(Date.parse(x.ts))}</span> — ${esc(txt.length > 150 ? txt.slice(0, 149) + '…' : txt)}`;
  }

  /* ---------------- acta por acta + busca tu mesa ---------------- */
  const TIPO_ACTA = {
    'mas-votos-que-electores': 'Más votos que electores', 'suma-partidos': 'Los votos no suman los válidos', 'suma-emitidos': 'Válidos + blancos + nulos ≠ emitidos',
    'emitidos-asistentes': 'Emitidos ≠ asistentes', 'participacion-100': 'Participación del 100%', concentracion: 'Una organización con casi todos los votos',
    'cambio-despues-de-contabilizada': 'Cambió después de contabilizada',
  };
  async function renderActas() {
    const r = state.actas;
    const stats = $('#actasStats');
    if (!r) {
      stats.innerHTML = '';
      $('#actasNote').textContent = 'La revisión acta por acta empieza cuando la ONPE publique las primeras actas.';
      $('#actasList').innerHTML = ''; $('#actasPager').innerHTML = '';
      return;
    }
    stats.innerHTML = [[r.mesasEncontradas, 'mesas'], [r.actasLeidas, 'actas revisadas'], [r.actasContabilizadas, 'contabilizadas'], [r.avisos?.alerta, 'importantes'], [r.avisos?.revisar, 'para revisar']]
      .map(([v, l]) => `<div><b class="num">${n(v)}</b><span>${l}</span></div>`).join('');
    $('#actasNote').textContent = r.bloqueado ? `La ONPE dejó de responder a las consultas (${r.bloqueado}). Seguimos cuando vuelva.`
      : `${r.exploracionCompleta ? 'Ya recorrimos todos los números de mesa' : `Vamos por la mesa ${n(r.numerosExplorados)}`}; ahora volvemos a las actas que aún no están contabilizadas. Actualizado ${r.actualizado ? ago(Date.parse(r.actualizado)) : '—'}.`;
    if (!state.anomalias || state.anomaliasAt !== r.actualizado) {
      state.anomalias = await tryGet('actas/anomalias.json');
      state.anomaliasAt = r.actualizado;
    }
    const f = state.actasFilter || '';
    const items = (state.anomalias?.items || []).filter((x) => !f || x.severidad === f);
    const [i0, i1] = pager('actasPager', items.length, 8, renderActas);
    $('#actasList').innerHTML = items.length ? items.slice(i0, i1).map((x) => `<li class="check"><span class="badge ${esc(x.severidad)}">${x.severidad === 'alerta' ? 'Importante' : 'Revisar'}</span><div><b class="small">Mesa ${esc(x.mesa)} · ${esc(x.eleccion)}</b> <span class="small muted">${esc(title(x.local || ''))}</span><div>${esc(TIPO_ACTA[x.tipo] || x.tipo)}: ${esc(x.detalle)}</div><div class="small muted">Estado del acta: ${esc(x.estadoActa || '—')} · detectado ${ago(Date.parse(x.visto))}</div></div></li>`).join('')
      : '<li class="check"><span class="badge ok">OK</span><div>Ninguna acta revisada tiene diferencias.</div></li>';
  }
  $('#actasFilter').addEventListener('change', (ev) => { state.actasFilter = ev.target.value; state.pages.actasPager = 1; renderActas(); });

  $('#mesaForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const code = $('#mesaInput').value.replace(/\D/g, '').padStart(6, '0');
    const out = $('#mesaResult');
    if (!/^\d{6}$/.test(code) || code === '000000') { out.innerHTML = '<p class="small err">Escribe un número de mesa de 6 dígitos.</p>'; return; }
    out.innerHTML = '<div class="skeleton"></div>';
    const shard = await tryGet(`actas/mesas/${code.slice(0, 3)}.json`);
    const m = shard && shard[code];
    if (!m) { out.innerHTML = `<p class="small muted">Todavía no tenemos la mesa ${code}. ${isLive() ? 'La estamos recorriendo: vuelve a intentar en un rato.' : 'Aparecerá cuando la ONPE publique las actas.'}</p>`; return; }
    out.innerHTML = `<div class="mesa-head"><b>Mesa ${esc(code)}</b><span class="small muted">${esc(title(m.local || ''))} · consultada ${ago(Date.parse(m.consultado))}</span></div>` + m.actas.map((a) => `
      <div class="acta"><div class="scopehead"><b>${esc(a.eleccion)}</b><span class="badge ${/contabiliz/i.test(a.estado || '') ? 'ok' : 'info'}">${esc(a.estado || '—')}</span></div>
        <div class="statrow five small-stats"><div><b class="num">${n(a.electores)}</b><span>electores</span></div><div><b class="num">${n(a.emitidos)}</b><span>emitidos</span></div><div><b class="num">${n(a.validos)}</b><span>válidos</span></div><div><b class="num">${n(a.blancos)}</b><span>blancos</span></div><div><b class="num">${n(a.nulos)}</b><span>nulos</span></div></div>
        <table class="small"><tbody>${(a.partidos || []).map(([p, v]) => `<tr><td>${esc(title(p))}</td><td class="n num">${n(v)}</td></tr>`).join('')}</tbody></table></div>`).join('')
      + `<p class="small muted" style="margin:8px 0 0">Fuente: API pública de la ONPE. Compara con la foto del acta de tu mesa.</p>`;
  });

  /* ---------------- 6. mercados de predicción ---------------- */
  function renderMarkets() {
    const m = state.markets;
    const box = $('#markets');
    if (!m || !m.mercados?.length) {
      box.innerHTML = `<div class="empty">${esc(m?.nota || 'Esta sección se activa después del cierre de la votación (5:00 p. m.), para respetar la veda electoral sobre proyecciones de resultados.')}</div>`;
      return;
    }
    box.innerHTML = m.mercados.map((mk) => {
      const top = mk.opciones.slice(0, 8);
      return `<div class="market"><div class="scopehead"><h3>${esc(mk.titulo)}</h3><span class="chip">${n(Math.round(mk.volumenUSD || 0))} US$ negociados</span></div>
        <ul class="rank">${top.map((o, i) => `<li><div class="row"><span class="pos">${i + 1}</span><div class="who"><b>${esc(title(o.nombre))}</b></div><div class="right"><div class="pct">${pct(o.probabilidad * 100, 1)}</div><div class="votes ${o.cambio24h > 0 ? 'up' : o.cambio24h < 0 ? 'down' : ''}">${o.cambio24h ? `${o.cambio24h > 0 ? '▲' : '▼'} ${Math.abs(o.cambio24h * 100).toFixed(1)} pts en 24 h` : 'sin cambios en 24 h'}</div></div></div><div class="bar"><i style="width:${Math.min(100, o.probabilidad * 100)}%;background:var(--info)"></i></div></li>`).join('')}</ul>
        <p class="small muted" style="margin:8px 0 0">Actualizado ${ago(Date.parse(m.actualizado))}. Probabilidad implícita según el precio del mercado; puede cambiar en cualquier momento.</p></div>`;
    }).join('');
  }

  /* ---------------- 7. evidencia ---------------- */
  const MAX_BYTES = 10 * 1024 * 1024;
  const toB64 = (file) => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = ko; r.readAsDataURL(file); });
  $('#evForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fm = ev.target, msg = $('#evMsg'), btn = $('#evSend');
    const fd = new FormData(fm);
    const files = [...(fm.archivos.files || [])];
    const err = (t) => { msg.className = 'small err'; msg.textContent = t; };
    if (!fd.get('tipo')) return err('Elige qué pasó.');
    if (String(fd.get('descripcion') || '').trim().length < 20) return err('Cuéntanos un poco más (al menos 20 caracteres).');
    if (!fm.acepto.checked) return err('Marca la casilla de confirmación.');
    if (files.length > 3) return err('Puedes subir hasta 3 archivos.');
    if (files.reduce((t, x) => t + x.size, 0) > MAX_BYTES) return err('Los archivos pasan de 10 MB. Prueba con menos o más livianos.');
    btn.disabled = true; msg.className = 'small'; msg.textContent = 'Enviando…';
    try {
      const body = { tipo: fd.get('tipo'), lugar: fd.get('lugar'), mesa: fd.get('mesa'), descripcion: fd.get('descripcion'), enlace: fd.get('enlace'), contacto: fd.get('contacto'), web: fd.get('web'),
        archivos: await Promise.all(files.map(async (x) => ({ nombre: x.name, tipo: x.type, datos: await toB64(x) }))) };
      const r = await fetch('api/evidencia', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'No se pudo enviar. Intenta otra vez en un rato.');
      fm.reset();
      msg.className = 'small ok'; msg.innerHTML = `Recibido. Tu código es <b class="num">${esc(j.codigo)}</b>. Guárdalo: con él puedes preguntarnos por tu envío.`;
    } catch (e) { err(e.message); } finally { btn.disabled = false; }
  });

  function renderEvStats() {
    const x = state.evStats;
    $('#evStats').innerHTML = x ? `<div class="statrow"><div><b class="num">${n(x.recibidos)}</b><span>recibidos</span></div><div><b class="num">${n(x.enRevision)}</b><span>en revisión</span></div><div><b class="num">${n(x.verificados)}</b><span>verificados</span></div></div>` : '';
  }

  function renderFindings() {
    const items = state.findings?.items || [];
    const [i0, i1] = pager('findingsPager', items.length, 5, renderFindings);
    $('#findings').innerHTML = items.length ? items.slice(i0, i1).map((h) => `<li class="check"><span class="badge ${h.veredicto === 'confirmado' ? 'alerta' : h.veredicto === 'falso' ? 'ok' : 'revisar'}">${esc(h.veredicto)}</span><div><b class="small">${esc(h.titulo)}</b><div>${esc(h.detalle)}</div><div class="small muted">${esc(h.lugar || '')} · ${time(Date.parse(h.fecha), true)}${h.fuente ? ` · <a href="${esc(h.fuente)}" target="_blank" rel="noopener">fuente</a>` : ''}</div></div></li>`).join('') : '<li class="check"><span class="badge info">Aún nada</span><div>Cuando confirmemos o descartemos algo, aparecerá aquí con su fuente.</div></li>';
  }

  /* ---------------- 6. datos ---------------- */
  function renderFiles() {
    const base = location.origin + location.pathname.replace(/[^/]*$/, '') + DATA;
    const repo = state.cfg.repo || '#';
    const files = [
      ['📊', 'Resultados por región (Excel)', 'Un archivo CSV por elección. Se abre en Excel o Google Sheets.', `${repo}/tree/main/data/csv`],
      ['📈', 'Avance del conteo (Excel)', 'Cada actualización oficial con su hora exacta.', `${repo}/tree/main/data/series`],
      ['🧾', 'Respuestas originales de la ONPE', 'Exactamente lo que entregó la ONPE, sin cambios.', `${repo}/tree/main/data/onpe`],
      ['⚡', 'Resumen en vivo (JSON)', 'Todo el tablero en un solo archivo.', `${DATA}latest.json`],
      ['🔎', 'Revisiones (JSON)', 'Resultado de las comprobaciones.', `${DATA}checks.json`],
      ['🤖', 'Mensajes de los bots (JSON)', 'Todo lo que publicó el equipo de cobertura.', `${DATA}bots/feed.json`],
    ];
    $('#files').innerHTML = files.map(([ic, t, d, href]) => `<a class="card file" href="${esc(href)}" target="_blank" rel="noopener"><span class="ic">${ic}</span><b>${t}</b><span class="small muted">${d}</span></a>`).join('');
    $('#howto').textContent = `# Resumen en vivo\ncurl -s ${base}latest.json\n\n# Todo el historial, actualización por actualización\ngit clone ${repo}.git\ngit log --oneline -- data/latest.json`;
    for (const id of ['#repoLink', '#repoLink2']) $(id).href = repo;
  }

  /* ---------------- 7. apoyo ---------------- */
  function renderDonate() {
    const d = state.cfg.donaciones || {};
    const qrs = [['Plin', d.plin], ['Yape', d.yape]].filter(([, v]) => v);
    $('#qrs').innerHTML = qrs.map(([k, v]) => `<div class="qr"><img src="${esc(v)}" alt="Código QR para aportar por ${k}" loading="lazy"><span>${k}</span></div>`).join('');
    const w = d.cripto || [];
    $('#wallets').innerHTML = w.map((x) => `<div class="wallet"><b class="small">${esc(x.red)}</b><code>${esc(x.direccion)}</code><button class="copy" data-v="${esc(x.direccion)}">Copiar</button></div>`).join('');
    $('#wallets').querySelectorAll('.copy').forEach((b) => b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(b.dataset.v); b.textContent = 'Copiado ✔'; setTimeout(() => (b.textContent = 'Copiar'), 1500); } catch (e) { /* sin portapapeles */ } }));
    $('#donateEmpty').classList.toggle('hidden', qrs.length + w.length > 0);
  }

  /* ---------------- ciclo ---------------- */
  async function refresh() {
    const [status, latest, checks, sch, feed] = await Promise.all([tryGet('status.json'), tryGet('latest.json'), tryGet('checks.json'), tryGet('bots/schedule.json'), tryGet('bots/feed.json')]);
    state.status = status || { estado: 'esperando' };
    state.latest = latest; state.checks = checks; state.sch = sch; state.feed = feed; state.ambitos = {};
    renderStatus();
    if (isLive()) renderResults();
    renderLower(); renderChart(); renderChecks(); renderBots(); renderDay(); renderTicker(); rotateLowerThird();
    tryGet('actas/resumen.json').then((r) => { state.actas = r; renderStream(); renderActas(); });
    tryGet('mercados.json').then((m) => { state.markets = m; renderMarkets(); });
    tryGet('hallazgos.json').then((h) => { state.findings = h; renderFindings(); });
    fetch('api/stats', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((x) => { state.evStats = x; renderEvStats(); });
  }

  async function boot() {
    state.cfg = await fetch('config.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({}));
    Office.mount($('#office'), openAgent);
    showView();
    renderFiles();
    setInterval(rotateTicker, 6000);
    tickStream(); setInterval(tickStream, 1000);
    setInterval(rotateLowerThird, 8000);
    ping(); setInterval(ping, 30000);
    renderDonate();
    fetch('geo/peru.json').then((r) => r.json()).then((g) => { state.geo = g; if (isLive()) renderMap(current()); });
    renderCountdown();
    setInterval(renderCountdown, 1000);
    await refresh();
    setInterval(refresh, POLL_MS);
    setInterval(() => { if (state.sch) Office.update(state.sch.agentes || [], state.status?.estado, state.feed?.items); }, 15000);
  }
  boot();
})();
