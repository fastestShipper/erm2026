/* Oficina en vivo: cada agente de IA en su escritorio, dibujado en pixel art.
   Estados (de data/bots/schedule.json):
     activo           → teclea, monitor encendido, globo con lo que está haciendo
     cumpliendo       → sentado, monitor encendido, de vez en cuando toma café
     atrasado         → monitor apagado y un «!» rojo encima
     programado       → silla vacía con cartel «entra HH:MM»
     fuera-de-horario → silla vacía con cartel «terminó»
   Sin dependencias. Expone window.Office = { mount, update }. */
(() => {
  'use strict';
  const W = 384, H = 216;           // resolución lógica (pixeles «gordos»)
  const FPS = 8;

  // Apariencia de cada apodo: piel, pelo, estilo, polo, extra.
  const LOOKS = {
    'Norma':    { skin: '#c68863', hair: '#1b1412', style: 'bob',   shirt: '#c8102e', extra: 'glasses' },
    'Luchito':  { skin: '#a8714a', hair: '#141010', style: 'short', shirt: '#2457c5', extra: 'headset' },
    'Maritza':  { skin: '#b97c55', hair: '#2a1a12', style: 'long',  shirt: '#7b3fb8' },
    'Rosita':   { skin: '#d39a72', hair: '#3a2416', style: 'bun',   shirt: '#1a7f4b', extra: 'glasses' },
    'Kike':     { skin: '#9b6440', hair: '#0f0d0c', style: 'spiky', shirt: '#c2410c' },
    'Charo':    { skin: '#c48a64', hair: '#5b2d1a', style: 'long',  shirt: '#be185d' },
    'Jorge':    { skin: '#a56b46', hair: '#1d1714', style: 'short', shirt: '#0f8a9d', extra: 'headset' },
    'Don Pepe': { skin: '#b07a55', hair: '#bdbdbd', style: 'bald',  shirt: '#475569', extra: 'mustache' },
    'Beto':     { skin: '#9d6a47', hair: '#191311', style: 'cap',   shirt: '#a8640a' },
    'Toño':     { skin: '#a87250', hair: '#141010', style: 'short', shirt: '#4d7c0f', extra: 'glasses' },
  };
  const SPARE_LOOKS = [
    { skin: '#b9825c', hair: '#201612', style: 'long', shirt: '#4d7c0f' },
    { skin: '#a06a45', hair: '#121010', style: 'short', shirt: '#0e7490' },
  ];

  // Posición de cada escritorio (x, y = esquina sup. izq. del escritorio). Norma al centro.
  const SLOTS = [
    [160, 132],                                   // 0: coordinación (centro, adelante)
    [40, 70], [128, 70], [216, 70], [304, 70],    // fila de atrás
    [40, 150], [304, 150], [84, 112], [260, 112], // costados
    [16, 112], [336, 112],
  ];

  const st = { root: null, cv: null, ctx: null, agents: [], t: 0, planes: [], bubbles: {}, status: null, onPick: null, lastFeedTs: null };
  const px = (x, y, w, h, c) => { st.ctx.fillStyle = c; st.ctx.fillRect(x | 0, y | 0, w | 0, h | 0); };

  /* ---------------- escenario ---------------- */
  function limaHour() { const d = new Date(Date.now() - 5 * 3600e3); return d.getUTCHours() + d.getUTCMinutes() / 60; }

  function sky(h) {
    if (h < 5.5 || h >= 19) return ['#0b1530', '#14224a'];
    if (h < 7) return ['#f2a65a', '#6d8fd1'];
    if (h < 17.5) return ['#7fb6ef', '#bfe0ff'];
    return ['#e9774a', '#5f6fb8'];
  }

  function drawRoom() {
    const h = limaHour();
    // pared y zócalo
    px(0, 0, W, 64, '#e7dfd0'); px(0, 60, W, 4, '#c9bda6');
    // piso a cuadros
    for (let y = 64; y < H; y += 8) for (let x = 0; x < W; x += 8) px(x, y, 8, 8, ((x + y) / 8) % 2 ? '#d8cdb7' : '#d1c5ad');
    // ventanas con cielo según la hora de Lima
    const [s1, s2] = sky(h);
    for (const wx of [18, 290]) {
      px(wx - 2, 8, 80, 40, '#8d7b62');
      px(wx, 10, 76, 36, s1); px(wx, 28, 76, 18, s2);
      if (h < 5.5 || h >= 19) for (let i = 0; i < 9; i++) px(wx + ((i * 23 + st.t) % 74), 12 + ((i * 7) % 14), 1, 1, i % 3 ? '#ffffff' : '#ffe9a8');
      else px(wx + 52, 14, 8, 8, h < 7 || h >= 17.5 ? '#ffd27a' : '#fff4c2');
      // cerros de Lima
      px(wx, 40, 76, 6, '#8a7a66'); px(wx + 10, 36, 20, 4, '#8a7a66'); px(wx + 44, 34, 24, 6, '#9a8a74');
      px(wx + 37, 10, 2, 36, '#8d7b62'); px(wx, 27, 76, 2, '#8d7b62');
    }
    // reloj con la hora de Lima
    px(178, 8, 28, 12, '#2b2b2b'); px(180, 10, 24, 8, '#0f1a10');
    // TV del estado de la ONPE (el texto va en HTML encima)
    px(108, 6, 64, 38, '#1b1b1f'); px(110, 8, 60, 32, st.status === 'en-vivo' ? '#0d3b25' : st.status === 'bloqueado' ? '#3b0d12' : '#1c2440');
    px(136, 44, 8, 6, '#2b2b2b');
    // pizarra
    px(214, 8, 64, 38, '#f7f7f2'); px(212, 6, 68, 2, '#9a9a9a'); px(212, 46, 68, 2, '#9a9a9a');
    // dispensador de agua y plantas
    px(358, 34, 12, 26, '#e9eef5'); px(360, 22, 8, 12, '#7ec3f0'); px(361, 40, 6, 3, '#9aa');
    plant(4, 46); plant(372, 140); plant(4, 190);
  }

  function plant(x, y) { px(x + 2, y + 10, 8, 8, '#a0522d'); px(x, y, 12, 10, '#2f7d32'); px(x + 3, y - 3, 6, 4, '#3c9a40'); }

  /* ---------------- personajes ---------------- */
  function person(x, y, look, a, frame) {
    const { skin, hair, style, shirt, extra } = look;
    const typing = a.estado === 'activo';
    const bob = typing && frame % 2 ? 1 : 0;
    // torso
    px(x + 1, y + 10, 12, 8, shirt); px(x + 1, y + 10, 12, 1, 'rgba(255,255,255,.18)');
    // cuello y cabeza
    px(x + 5, y + 8, 4, 2, skin);
    px(x + 3, y + bob, 8, 9, skin);
    // pelo
    if (style === 'short') { px(x + 3, y + bob - 1, 8, 3, hair); px(x + 2, y + bob, 1, 4, hair); px(x + 11, y + bob, 1, 4, hair); }
    if (style === 'spiky') { px(x + 3, y + bob - 1, 8, 3, hair); for (let i = 0; i < 4; i++) px(x + 3 + i * 2, y + bob - 3, 1, 2, hair); }
    if (style === 'bob') { px(x + 2, y + bob - 1, 10, 3, hair); px(x + 2, y + bob, 2, 8, hair); px(x + 10, y + bob, 2, 8, hair); }
    if (style === 'long') { px(x + 2, y + bob - 1, 10, 3, hair); px(x + 1, y + bob, 2, 13, hair); px(x + 11, y + bob, 2, 13, hair); }
    if (style === 'bun') { px(x + 3, y + bob - 1, 8, 3, hair); px(x + 5, y + bob - 4, 4, 3, hair); }
    if (style === 'bald') { px(x + 2, y + bob + 2, 1, 3, hair); px(x + 11, y + bob + 2, 1, 3, hair); }
    if (style === 'cap') { px(x + 2, y + bob - 1, 10, 3, shirt); px(x + 1, y + bob + 1, 6, 1, shirt); }
    // cara: ojos (parpadean), anteojos, bigote
    const blink = (st.t + x) % 37 === 0;
    px(x + 5, y + bob + 4, 1, blink ? 0 : 1, '#1a1a1a'); px(x + 8, y + bob + 4, 1, blink ? 0 : 1, '#1a1a1a');
    if (extra === 'glasses') { px(x + 4, y + bob + 3, 3, 3, 'rgba(30,30,30,.55)'); px(x + 7, y + bob + 3, 3, 3, 'rgba(30,30,30,.55)'); px(x + 5, y + bob + 4, 1, 1, '#cfe8ff'); px(x + 8, y + bob + 4, 1, 1, '#cfe8ff'); }
    if (extra === 'mustache') px(x + 5, y + bob + 6, 4, 1, hair);
    if (extra === 'headset') { px(x + 2, y + bob + 2, 1, 4, '#222'); px(x + 3, y + bob - 1, 8, 1, '#222'); px(x + 3, y + bob + 6, 3, 1, '#222'); }
    // brazos: tecleando o tomando café
    const coffee = !typing && a.estado === 'cumpliendo' && (st.t + x) % 60 < 10;
    if (typing) { px(x - 1, y + 14 + (frame % 2), 3, 3, skin); px(x + 12, y + 14 + ((frame + 1) % 2), 3, 3, skin); }
    else if (coffee) { px(x + 11, y + 9, 3, 6, skin); px(x + 12, y + 6, 4, 4, '#ffffff'); px(x + 13, y + 7, 2, 1, '#6b3e1f'); }
  }

  function desk(x, y, a, look, frame) {
    const seated = a.estado === 'activo' || a.estado === 'cumpliendo' || a.estado === 'atrasado';
    // silla
    px(x + 13, y - 18, 18, 14, '#3d3d46'); px(x + 15, y - 16, 14, 10, '#4c4c58');
    if (seated) person(x + 15, y - 22, look, a, frame);
    // escritorio
    px(x, y, 44, 4, '#9b6b3e'); px(x, y + 4, 44, 14, '#7f5530'); px(x + 2, y + 18, 3, 6, '#5e3d22'); px(x + 39, y + 18, 3, 6, '#5e3d22');
    // monitor
    const on = a.estado === 'activo' || a.estado === 'cumpliendo';
    px(x + 4, y - 12, 16, 11, '#222'); px(x + 5, y - 11, 14, 9, on ? '#183b6b' : '#0c0c0c');
    if (on) for (let i = 0; i < 3; i++) px(x + 6, y - 10 + i * 3, ((st.t * (a.estado === 'activo' ? 3 : 1) + i * 5 + x) % 11) + 1, 1, '#8fd3ff');
    px(x + 10, y - 1, 4, 1, '#222');
    // teclado, taza y papeles
    px(x + 22, y + 1, 12, 2, '#cfcfd6'); px(x + 36, y - 3, 4, 4, '#ffffff'); px(x + 37, y - 2, 2, 1, '#6b3e1f');
    if (a.publicaciones > 3) px(x + 26, y - 3, 8, 3, '#f4f1e8');
    // estados especiales
    if (a.estado === 'atrasado' && frame % 2) { px(x + 21, y - 40, 4, 9, '#e5363b'); px(x + 21, y - 29, 4, 3, '#e5363b'); }
    if (!seated) { px(x + 14, y - 6, 16, 8, '#fff7d6'); px(x + 14, y - 6, 16, 1, '#c9b46a'); }
    // luz de estado en el escritorio
    const led = { activo: '#3ccf8e', cumpliendo: '#3ccf8e', atrasado: '#e5363b', programado: '#7aa2ff', 'fuera-de-horario': '#888' }[a.estado] || '#888';
    if (a.estado !== 'activo' || frame % 2) px(x + 40, y + 6, 2, 2, led);
  }

  function drawPlanes() {
    st.planes = st.planes.filter((p) => p.k < 1);
    for (const p of st.planes) {
      p.k += 0.06;
      const x = p.x0 + (p.x1 - p.x0) * p.k, y = p.y0 + (p.y1 - p.y0) * p.k - Math.sin(p.k * Math.PI) * 24;
      px(x, y, 5, 2, '#ffffff'); px(x + 1, y - 1, 3, 1, '#ffffff'); px(x, y + 2, 2, 1, '#cfcfcf');
    }
  }

  /* ---------------- HTML encima del canvas (texto nítido) ---------------- */
  function pos(x, y) { return `left:${(100 * x) / W}%;top:${(100 * y) / H}%`; }

  function overlay() {
    const o = st.root.querySelector('.office-ov');
    const lima = new Date().toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit' });
    const tv = st.status === 'en-vivo' ? 'ONPE: EN VIVO' : st.status === 'bloqueado' ? 'ONPE: NO RESPONDE' : 'ONPE: PRÓXIMAMENTE';
    let html = `<div class="ov-clock" style="${pos(180, 9)}">${lima}</div><div class="ov-tv" style="${pos(110, 14)}">${tv}</div><div class="ov-board" style="${pos(216, 12)}">ERM 2026<br><small>4 de octubre</small></div>`;
    const active = st.agents.filter((a) => a.estado === 'activo' && a.haciendo).sort((x, y) => y.haciendo.ts.localeCompare(x.haciendo.ts)).slice(0, 3);
    st.agents.forEach((a, i) => {
      const [x, y] = SLOTS[i] || SLOTS[0];
      const seated = a.estado === 'activo' || a.estado === 'cumpliendo' || a.estado === 'atrasado';
      const sign = a.estado === 'programado' ? `entra ${a.inicio}` : a.estado === 'fuera-de-horario' ? 'terminó' : '';
      html += `<button class="ov-tag ${a.estado}" style="${pos(x + 22, y + 26)}" data-i="${i}" aria-label="${esc(a.agente)}, ${esc(a.puesto)}"><b>${esc(a.agente)}</b><span>${esc(a.puesto)}</span></button>`;
      if (sign) html += `<div class="ov-sign" style="${pos(x + 22, y - 4)}">${esc(sign)}</div>`;
      if (seated && active.includes(a)) html += `<div class="ov-bubble" style="${pos(x + 22, y - 26)}">${esc(trim(a.haciendo.texto, 90))}</div>`;
      else if (a.estado === 'activo') html += `<div class="ov-dots" style="${pos(x + 22, y - 26)}">···</div>`;
    });
    o.innerHTML = html;
    o.querySelectorAll('.ov-tag').forEach((b) => b.addEventListener('click', () => st.onPick && st.onPick(st.agents[+b.dataset.i])));
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const trim = (s, n) => { s = String(s).replace(/\*\*|`|\[|\]\([^)]*\)/g, '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  /* ---------------- ciclo ---------------- */
  let spare = 0;
  function lookFor(a) { return LOOKS[a.agente] || (a._look ||= SPARE_LOOKS[spare++ % SPARE_LOOKS.length]); }

  function frame() {
    st.t++;
    const f = st.t;
    drawRoom();
    // se dibuja de atrás hacia adelante para que los de adelante tapen
    const order = st.agents.map((a, i) => i).sort((i, j) => (SLOTS[i] || SLOTS[0])[1] - (SLOTS[j] || SLOTS[0])[1]);
    for (const i of order) { const [x, y] = SLOTS[i] || SLOTS[0]; desk(x, y, st.agents[i], lookFor(st.agents[i]), f); }
    drawPlanes();
    if (f % FPS === 0) overlay();
  }

  function mount(root, onPick) {
    st.root = root; st.onPick = onPick;
    root.innerHTML = `<div class="office-stage"><canvas width="${W}" height="${H}" aria-label="Oficina en vivo: agentes de IA trabajando"></canvas><div class="office-ov"></div></div>`;
    st.cv = root.querySelector('canvas'); st.ctx = st.cv.getContext('2d');
    st.ctx.imageSmoothingEnabled = false;
    setInterval(frame, 1000 / FPS);
  }

  // feedItems: los mensajes nuevos desde la última vez generan un avioncito de papel
  // desde la coordinación hacia quien recibe el encargo (o hacia la coordinación si alguien reporta).
  function update(agents, status, feedItems) {
    st.agents = agents.slice().sort((a, b) => (a.agente === 'Norma' ? -1 : b.agente === 'Norma' ? 1 : 0));
    st.status = status;
    const idx = Object.fromEntries(st.agents.map((a, i) => [a.agente, i]));
    const center = (i) => { const [x, y] = SLOTS[i] || SLOTS[0]; return [x + 22, y - 10]; };
    if (st.lastFeedTs && feedItems) {
      const fresh = feedItems.filter((x) => x.ts > st.lastFeedTs).slice(0, 6);
      for (const it of fresh) {
        const from = it.tipo === 'recibe' ? idx.Norma : idx[it.agente];
        const to = it.tipo === 'recibe' ? idx[it.agente] : idx.Norma;
        if (from === undefined || to === undefined || from === to) continue;
        const [x0, y0] = center(from), [x1, y1] = center(to);
        st.planes.push({ x0, y0, x1, y1, k: -Math.random() * 0.5 });
      }
    }
    if (feedItems && feedItems[0]) st.lastFeedTs = feedItems[0].ts;
    if (st.root) overlay();
  }

  // color del polo de cada agente: se usa también en el chat y en el cintillo
  const colorOf = (name) => (LOOKS[name] || {}).shirt || '#7aa2ff';

  window.Office = { mount, update, colorOf };
})();
