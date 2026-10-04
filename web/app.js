/* ERM 2026 · dashboard de datos abiertos. Sin dependencias. */
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
  const time = (ms, withDate) => (ms ? new Date(ms).toLocaleString('es-PE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', ...(withDate ? { day: 'numeric', month: 'short' } : {}) }) : '—');
  const ago = (ms) => { if (!ms) return '—'; const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'hace segundos' : m < 60 ? `hace ${m} min` : `hace ${Math.floor(m / 60)} h ${m % 60} min`; };
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/^EL\s+/, '').trim();

  const PALETTE = ['#2457c5', '#c8102e', '#1a7f4b', '#a8640a', '#7b3fb8', '#0f8a9d', '#c2410c', '#4d7c0f', '#be185d', '#475569', '#0e7490', '#9a3412'];
  const colorFor = (code, name) => { const k = String(code ?? name ?? ''); let h = 0; for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };

  const state = { cfg: {}, status: null, latest: null, eid: null, scope: 'nacional', geo: null, ambitos: {}, lowerQuery: '' };

  async function get(path, type = 'json') {
    const r = await fetch(DATA + path + (path.includes('?') ? '&' : '?') + 't=' + Math.floor(Date.now() / 30000), { cache: 'no-store' });
    if (!r.ok) throw new Error(path + ' ' + r.status);
    return type === 'text' ? r.text() : r.json();
  }
  const tryGet = (p, t) => get(p, t).catch(() => null);

  /* ---------------- tema ---------------- */
  $('#theme').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('erm-theme', next); } catch (e) { /* sin storage */ }
  });

  /* ---------------- estado ---------------- */
  function renderStatus() {
    const s = state.status || {};
    const el = $('#status');
    const live = s.estado === 'en-vivo';
    el.className = 'pill ' + (live ? 'live' : s.estado === 'error' ? 'err' : 'wait');
    $('#statusText').textContent = live ? 'En vivo · datos oficiales ONPE' : s.estado === 'error' ? 'Sin conexión con la ONPE' : 'Esperando resultados oficiales';
    $('#onpeTime').textContent = 'Corte ONPE: ' + (s.ultimaActualizacionOnpe ? time(s.ultimaActualizacionOnpe, true) : '—');
    $('#checkTime').textContent = 'Última consulta: ' + (s.consultado ? ago(Date.parse(s.consultado)) : '—');
    $('#waiting').classList.toggle('hidden', live);
    for (const id of ['#resultados', '#evolucion']) $(id).classList.toggle('hidden', !live);
    if (!live && s.detalle) $('#waitDetail').textContent = s.detalle + ' Este tablero no muestra estimaciones ni proyecciones: solo cifras oficiales.';
  }

  function renderCountdown() {
    const left = CLOSE - Date.now();
    const box = $('#countdown');
    if (left <= 0) { box.innerHTML = ''; $('#countLabel').textContent = 'La votación ya cerró. Los resultados aparecen aquí apenas la ONPE los publique.'; return; }
    const h = Math.floor(left / 3.6e6), m = Math.floor((left % 3.6e6) / 6e4), s = Math.floor((left % 6e4) / 1e3);
    box.innerHTML = [[h, 'horas'], [m, 'min'], [s, 'seg']].map(([v, l]) => `<div><b>${String(v).padStart(2, '0')}</b><span>${l}</span></div>`).join('');
  }

  function renderDay() {
    const items = [['06:00', 'Instalación de mesas'], ['07:00', 'Inicio de la votación'], ['17:00', 'Cierre de la votación y conteo en mesa'], ['17:00+', 'La ONPE empieza a publicar resultados por actas']];
    const now = Date.now();
    $('#dayline').innerHTML = items.map(([h, t], i) => {
      const at = Date.parse(`2026-10-04T${h.replace('+', '')}:00-05:00`);
      const next = items[i + 1] ? Date.parse(`2026-10-04T${items[i + 1][0].replace('+', '')}:00-05:00`) : Infinity;
      const cls = now >= next ? 'past' : now >= at ? 'now' : '';
      return `<li class="${cls}"><span class="h">${h}</span><span>${esc(t)}</span></li>`;
    }).join('');
  }

  /* ---------------- resultados ---------------- */
  const current = () => (state.latest?.elecciones || []).find((e) => e.id === state.eid) || (state.latest?.elecciones || [])[0];

  function renderTabs() {
    const els = state.latest?.elecciones || [];
    if (!els.find((e) => e.id === state.eid)) state.eid = els[0]?.id;
    $('#procName').textContent = state.latest?.proceso?.nombre || '';
    $('#tabs').innerHTML = els.map((e) => `<button class="tab" role="tab" aria-selected="${e.id === state.eid}" data-id="${e.id}">${esc(e.menu || e.nombre)}</button>`).join('');
    $('#tabs').querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { state.eid = +b.dataset.id; state.scope = 'nacional'; renderResults(); }));
  }

  function renderKpis(t) {
    t = t || {};
    const cards = [
      ['Actas contabilizadas', pct(t.actasContabilizadas, 3), `${n(t.contabilizadas)} de ${n(t.totalActas)}`, t.actasContabilizadas],
      ['Participación', pct(t.participacionCiudadana, 2), 'de electores hábiles', t.participacionCiudadana],
      ['Votos emitidos', n(t.totalVotosEmitidos), `${n(t.totalVotosValidos)} válidos`],
      ['Actas en el JEE', n(t.enviadasJee), `${pct(t.actasEnviadasJee, 2)} · observadas`],
    ];
    $('#kpis').innerHTML = cards.map(([l, v, s, b]) => `<div class="card kpi"><div class="lbl">${l}</div><div class="val num">${v}</div><div class="sub">${s}</div>${b !== undefined ? `<div class="bar"><i style="width:${Math.min(100, +b || 0)}%"></i></div>` : ''}</div>`).join('');
  }

  function scopeData(e) {
    if (state.scope === 'nacional') return { name: 'Nacional', t: e.totales, p: e.participantes };
    const d = (e.departamentos || []).find((x) => x.ubigeo === state.scope);
    return d ? { name: d.nombre, t: d.totales, p: d.participantes } : { name: 'Nacional', t: e.totales, p: e.participantes };
  }

  function renderRank(e) {
    const sd = scopeData(e);
    $('#scopeTitle').textContent = sd.name;
    const sel = $('#scope');
    sel.innerHTML = `<option value="nacional">Nacional (agregado)</option>` + (e.departamentos || []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map((d) => `<option value="${esc(d.ubigeo)}">${esc(d.nombre)}</option>`).join('');
    sel.value = state.scope;
    const t = sd.t || {};
    $('#scopeChips').innerHTML = [`Actas ${pct(t.actasContabilizadas, 2)}`, `Válidos ${n(t.totalVotosValidos)}`, t.fechaActualizacion ? `Corte ${time(t.fechaActualizacion)}` : null].filter(Boolean).map((c) => `<span class="chip num">${esc(c)}</span>`).join('');
    const rows = (sd.p || []).filter((p) => p.votos !== null);
    const max = Math.max(1, ...rows.map((p) => p.votos || 0));
    $('#rank').innerHTML = rows.length ? rows.map((p) => {
      const col = colorFor(p.codPartido, p.partido);
      const who = p.candidato ? `<b>${esc(p.candidato)}<a class="cv" href="https://votoinformado.jne.gob.pe/" target="_blank" rel="noopener" title="Buscar en JNE Voto Informado">Hoja de vida ↗</a></b><span>${esc(p.partido)}</span>` : `<b>${esc(p.partido)}</b>`;
      return `<li><div class="row"><div class="who">${who}</div><div><div class="pct">${pct(p.pctValidos, 2)}</div><div class="votes num">${n(p.votos)}</div></div></div><div class="bar"><i style="width:${(100 * (p.votos || 0)) / max}%;background:${col}"></i></div></li>`;
    }).join('') : `<li class="empty">La ONPE aún no publica votos para este ámbito.</li>`;
  }

  function renderMap(e) {
    if (!state.geo) { $('#map').innerHTML = '<div class="skeleton" style="height:320px"></div>'; return; }
    const byName = {};
    for (const d of e.departamentos || []) byName[norm(d.nombre)] = d;
    const W = 420, H = 560, lon0 = -81.4, lon1 = -68.6, lat0 = 0.1, lat1 = -18.4, k = Math.cos((9 * Math.PI) / 180);
    const sx = W / ((lon1 - lon0) * k), sy = H / (lat0 - lat1), s = Math.min(sx, sy);
    const P = ([x, y]) => `${((x - lon0) * k * s).toFixed(1)},${((lat0 - y) * s).toFixed(1)}`;
    const ring = (r) => 'M' + r.map(P).join('L') + 'Z';
    const legend = new Map();
    const paths = state.geo.features.map((f) => {
      const g = f.geometry, rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
      const name = f.properties.name;
      if (/titicaca/i.test(name)) return `<path d="${rings.map(ring).join('')}" fill="var(--info-soft)" style="cursor:default"></path>`;
      const d = byName[norm(name)] || byName[norm(name.replace('Junin', 'Junín'))];
      let fill = 'var(--surface-2)', tip = `${name}: sin datos`;
      const lead = d?.participantes?.find((p) => p.votos);
      if (lead) {
        fill = colorFor(lead.codPartido, lead.partido);
        legend.set(lead.partido, fill);
        tip = `${d.nombre}: ${lead.candidato ? lead.candidato + ' · ' : ''}${lead.partido} ${pct(lead.pctValidos, 1)} · actas ${pct(d.totales?.actasContabilizadas, 1)}`;
      }
      const op = lead ? 0.35 + 0.65 * Math.min(1, (d.totales?.actasContabilizadas || 0) / 100) : 1;
      return `<path d="${rings.map(ring).join('')}" fill="${fill}" fill-opacity="${op.toFixed(2)}" data-u="${esc(d?.ubigeo || '')}" class="${d && d.ubigeo === state.scope ? 'sel' : ''}"><title>${esc(tip)}</title></path>`;
    }).join('');
    $('#map').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Mapa del Perú por departamento">${paths}</svg>`;
    $('#map').querySelectorAll('path[data-u]').forEach((p) => p.addEventListener('click', () => { if (p.dataset.u) { state.scope = state.scope === p.dataset.u ? 'nacional' : p.dataset.u; renderResults(); } }));
    $('#legend').innerHTML = [...legend].map(([k, c]) => `<span><i style="background:${c}"></i>${esc(k)}</span>`).join('') + (legend.size ? '<span class="muted">· más opaco = más actas contadas</span>' : '');
  }

  async function renderLower(e) {
    const box = $('#lowerBox');
    if (!e || e.nivel < 2) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const a = state.ambitos[e.id] || (state.ambitos[e.id] = await tryGet(`ambitos/eleccion-${e.id}.json`));
    const q = norm(state.lowerQuery);
    const rows = Object.values({ ...(a?.provincias || {}), ...(a?.distritos || {}) }).filter((r) => !q || norm(r.nombre).includes(q)).sort((x, y) => x.nombre.localeCompare(y.nombre));
    $('#lowerTitle').textContent = e.nivel === 3 ? 'Distritos' : 'Provincias';
    $('#lowerTable').innerHTML = `<thead><tr><th>Ámbito</th><th>Primer lugar</th><th class="n">%</th><th class="n">Actas</th></tr></thead><tbody>` +
      (rows.slice(0, 400).map((r) => { const l = (r.participantes || [])[0] || {}; return `<tr><td>${esc(r.nombre)}</td><td>${esc(l.candidato || '')}<div class="small muted">${esc(l.partido || '—')}</div></td><td class="n num">${pct(l.pctValidos, 1)}</td><td class="n num">${pct(r.totales?.actasContabilizadas, 1)}</td></tr>`; }).join('') || `<tr><td colspan="4" class="empty">Todavía no hay ámbitos descargados.</td></tr>`) + '</tbody>';
    $('#lowerNote').textContent = a ? `${n(Object.keys(a.provincias || {}).length)} provincias y ${n(Object.keys(a.distritos || {}).length)} distritos descargados · ${n(a.pendientes)} en cola (se recorren por tandas para no saturar a la ONPE).` : '';
  }

  async function renderChart(e) {
    const csv = await tryGet(`series/eleccion-${e.id}.csv`, 'text');
    const rows = (csv || '').trim().split('\n').slice(1).map((l) => l.split(',')).filter((r) => r[0]).map((r) => ({ t: +r[0], v: +r[2] }));
    if (rows.length < 2) { $('#chart').innerHTML = '<div class="empty">La curva aparece desde el segundo corte de la ONPE.</div>'; return; }
    const W = 800, H = 220, L = 44, B = 26, T = 10, R = 12;
    const t0 = rows[0].t, t1 = rows[rows.length - 1].t;
    const X = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R), Y = (v) => T + (1 - v / 100) * (H - T - B);
    const pts = rows.map((r) => `${X(r.t).toFixed(1)},${Y(r.v).toFixed(1)}`);
    const grid = [0, 25, 50, 75, 100].map((v) => `<line class="axis" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="lbl" x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${v}%</text>`).join('');
    const ticks = [rows[0], rows[Math.floor(rows.length / 2)], rows[rows.length - 1]].map((r) => `<text class="lbl" x="${X(r.t)}" y="${H - 6}" text-anchor="middle">${time(r.t)}</text>`).join('');
    $('#chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}<path class="area" d="M${pts[0].split(',')[0]},${Y(0)}L${pts.join('L')}L${pts[pts.length - 1].split(',')[0]},${Y(0)}Z"/><polyline class="line" points="${pts.join(' ')}"/>${ticks}</svg><p class="small muted" style="margin:6px 0 0">${n(rows.length)} cortes · último ${pct(rows[rows.length - 1].v, 3)} a las ${time(t1)} · <a href="${DATA}series/eleccion-${e.id}.csv" download>descargar CSV</a></p>`;
  }

  function renderResults() {
    const e = current();
    if (!e) return;
    renderTabs();
    renderKpis(e.totales);
    renderMap(e);
    renderRank(e);
    renderLower(e);
    renderChart(e);
  }
  $('#scope').addEventListener('change', (ev) => { state.scope = ev.target.value; renderResults(); });
  $('#lowerSearch').addEventListener('input', (ev) => { state.lowerQuery = ev.target.value; renderLower(current()); });

  /* ---------------- verificaciones ---------------- */
  function renderChecks(c, live) {
    const items = c?.items || [];
    if (!live) { $('#checks').innerHTML = `<li class="check"><span class="badge info">En espera</span><div>Las verificaciones corren en cada corte, apenas la ONPE publique resultados.</div></li>`; return; }
    $('#checks').innerHTML = items.length ? items.slice(0, 60).map((x) => `<li class="check"><span class="badge ${esc(x.severidad)}">${esc(x.severidad)}</span><div><b class="small">${esc(x.ambito)}</b><div>${esc(x.detalle)}</div></div></li>`).join('')
      : `<li class="check"><span class="badge ok">OK</span><div>Todas las verificaciones pasan en el último corte: sumas, porcentajes y acumulados son consistentes.</div></li>`;
  }

  /* ---------------- bots ---------------- */
  const LABEL = { cumpliendo: ['ok', 'Cumpliendo'], atrasado: ['alerta', 'Atrasado'], programado: ['info', 'Programado'], 'fuera-de-horario': ['info', 'Fuera de horario'] };
  function linkify(t) {
    let s = esc(t);
    s = s.replace(/\[([^\]]{1,120})\]\((https:\/\/[^\s)]+)\)/g, (m, a, u) => `<a href="${u}" target="_blank" rel="noopener nofollow">${a}</a>`);
    s = s.replace(/(^|[\s(])(https:\/\/[^\s<)]+)/g, (m, p, u) => `${p}<a href="${u}" target="_blank" rel="noopener nofollow">${u}</a>`);
    return s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  }
  function renderBots(sch, feed) {
    const ag = sch?.agentes || [];
    $('#agents').innerHTML = ag.length ? ag.map((a) => {
      const [cls, lbl] = LABEL[a.estado] || ['info', a.estado];
      return `<div class="card agent"><div class="head"><h3>${esc(a.agente)}</h3><span class="badge ${cls}">${lbl}</span></div><p>${esc(a.rol)}</p><div class="meta">Desde ${esc(a.inicio)} · ${n(a.publicaciones)} publicaciones<br>Última actividad: ${a.ultimaActividad ? `${time(Date.parse(a.ultimaActividad))} (${ago(Date.parse(a.ultimaActividad))})` : '—'}</div></div>`;
    }).join('') : '<div class="card empty">El estado de los bots se publica en breve.</div>';
    $('#plan').innerHTML = (sch?.plan || []).map((p) => `<li><span class="h">${esc(p.hora)}</span><span>${esc(p.que)} <span class="muted small">· ${esc(p.quien.join(', '))}</span></span></li>`).join('');
    const items = feed?.items || [];
    $('#feedNote').textContent = feed?.nota || '';
    $('#feed').innerHTML = items.length ? items.map((x) => `<li><span class="who">${esc(x.agente)}</span><span class="when">${time(Date.parse(x.ts), true)}</span><div class="txt">${linkify(x.texto)}</div></li>`).join('') : '<li class="empty">Sin publicaciones todavía.</li>';
  }

  /* ---------------- datos abiertos ---------------- */
  function renderFiles() {
    const base = location.origin + location.pathname.replace(/[^/]*$/, '') + DATA;
    const files = [
      ['latest.json', 'Resumen en vivo', 'Todas las elecciones: totales, candidatos y departamentos.'],
      ['csv/', 'CSV por departamento', 'Una fila por candidato y departamento, listo para Excel.'],
      ['series/', 'Serie de cortes', 'Cada corte nacional de la ONPE con hora exacta.'],
      ['onpe/', 'Respuestas crudas', 'Lo que entregó la ONPE, sin tocar.'],
      ['checks.json', 'Verificaciones', 'Resultado de las verificaciones del último corte.'],
      ['bots/feed.json', 'Bitácora de bots', 'Todo lo que publicó el equipo de cobertura.'],
    ];
    $('#files').innerHTML = files.map(([p, t, d]) => `<a class="card file" href="${p.endsWith('/') && state.cfg.repo ? state.cfg.repo + '/tree/main/data/' + p : DATA + p}" target="_blank" rel="noopener"><b>${t}</b><span class="small muted">${d}</span><br><code>${esc(p)}</code></a>`).join('');
    $('#howto').textContent = `# Resumen en vivo (JSON)\ncurl -s ${base}latest.json\n\n# Clonar todo, con el historial de cada corte\ngit clone ${state.cfg.repo || 'https://github.com/…'}.git\ngit log --oneline -- data/latest.json\n\n# Python\nimport requests\nd = requests.get("${base}latest.json").json()\nfor e in d["elecciones"]:\n    print(e["nombre"], e["totales"].get("actasContabilizadas"))`;
  }

  /* ---------------- apoyo ---------------- */
  function renderDonate() {
    const d = state.cfg.donaciones || {};
    const qrs = [['Plin', d.plin], ['Yape', d.yape]].filter(([, v]) => v);
    $('#qrs').innerHTML = qrs.map(([k, v]) => `<div class="qr"><img src="${esc(v)}" alt="QR ${k}" loading="lazy"><span>${k}</span></div>`).join('');
    const w = d.cripto || [];
    $('#wallets').innerHTML = w.map((x) => `<div class="wallet"><b class="small">${esc(x.red)}</b><code>${esc(x.direccion)}</code><button class="copy" data-v="${esc(x.direccion)}">Copiar</button></div>`).join('');
    $('#wallets').querySelectorAll('.copy').forEach((b) => b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(b.dataset.v); b.textContent = 'Copiado'; setTimeout(() => (b.textContent = 'Copiar'), 1500); } catch (e) { /* sin portapapeles */ } }));
    $('#donateEmpty').classList.toggle('hidden', qrs.length + w.length > 0);
  }

  /* ---------------- ciclo ---------------- */
  async function refresh() {
    const [status, latest, checks, sch, feed] = await Promise.all([tryGet('status.json'), tryGet('latest.json'), tryGet('checks.json'), tryGet('bots/schedule.json'), tryGet('bots/feed.json')]);
    state.status = status || { estado: 'esperando' };
    renderStatus();
    const live = state.status.estado === 'en-vivo' && latest?.elecciones?.length;
    if (live) { state.latest = latest; state.ambitos = {}; renderResults(); }
    renderChecks(checks, live);
    renderBots(sch, feed);
    renderDay();
  }

  async function boot() {
    state.cfg = await fetch('config.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({}));
    for (const id of ['#repoLink', '#repoLink2']) if (state.cfg.repo) $(id).href = state.cfg.repo;
    renderFiles();
    renderDonate();
    fetch('geo/peru.json').then((r) => r.json()).then((g) => { state.geo = g; if (current()) renderMap(current()); });
    renderCountdown();
    setInterval(renderCountdown, 1000);
    await refresh();
    setInterval(refresh, POLL_MS);
  }
  boot();
})();
