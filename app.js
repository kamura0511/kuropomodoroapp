'use strict';
// =====================================================================
// 設定
//   パーツ座標はすべて元画像（1402x1122）のピクセル。
//   表情を増やすときは parts に追加して、Face.set('名前') で切り替える。
// =====================================================================
const CONFIG = {
  base: { w: 1402, h: 1122, focusX: 900, focusY: 330 },   // 縦長画面ではここ（顔）が真ん中に来るように切り取る
  parts: {
    eyes:  { src: 'assets/eyes_closed.png', x: 740, y: 160, w: 320, h: 190 },
    mouth: { src: 'assets/mouth_open.png', rmap: 'assets/mouth_rmap.png', x: 875, y: 345, w: 135, h: 100 },
    // 例: smile: { src: 'assets/face_smile.png', x: 0, y: 0, w: 0, h: 0, face: true },
  },
  minutes: { work: 25, short: 5, long: 15 },
  longEvery: 4,
  storageKey: 'kuro-pomodoro-v1',
};

// ?speed=60 を付けると 60倍速（動作確認用）
const SPEED = Math.max(1, Number(new URLSearchParams(location.search).get('speed')) || 1);
const MIN = 60000 / SPEED;
const DUR = { work: CONFIG.minutes.work * MIN, short: CONFIG.minutes.short * MIN, long: CONFIG.minutes.long * MIN };

const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// =====================================================================
// 画面：クロの配置（縦長でも顔が切れないように切り取る）
// =====================================================================
const Scene = (() => {
  const stage = $('stage'), scene = $('scene'), char = $('char');
  const { w: BW, h: BH } = CONFIG.base;
  const els = {};

  for (const [name, p] of Object.entries(CONFIG.parts)) {
    const el = p.rmap ? document.createElement('canvas') : document.createElement('img');
    if (p.rmap) { el.width = p.w; el.height = p.h; } else { el.src = p.src; el.alt = ''; }
    el.className = 'part';
    Object.assign(el.style, {
      left: p.x / BW * 100 + '%', top: p.y / BH * 100 + '%',
      width: p.w / BW * 100 + '%', height: p.h / BH * 100 + '%',
    });
    if (!p.rmap) el.style.opacity = 0;
    char.appendChild(el);
    els[name] = el;
  }

  function layout() {
    const W = stage.clientWidth, H = stage.clientHeight;
    const s = Math.max(W / BW, H / BH);
    const sw = BW * s, sh = BH * s;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const x = clamp(W / 2 - CONFIG.base.focusX * s, W - sw, 0);
    const y = clamp(H * 0.42 - CONFIG.base.focusY * s, H - sh, 0);
    Object.assign(scene.style, { width: sw + 'px', height: sh + 'px', transform: `translate(${x}px,${y}px)` });
  }
  new ResizeObserver(layout).observe(stage);
  layout();
  return { els, char };
})();

// =====================================================================
// 口の描画（開き度マップ方式）
// =====================================================================
const Mouth = (() => {
  const p = CONFIG.parts.mouth, W = p.w, H = p.h;
  const ctx = Scene.els.mouth.getContext('2d');
  let out, idx, srcA, rmap, last = -1;
  const load = url => new Promise((ok, ng) => { const im = new Image(); im.onload = () => ok(im); im.onerror = ng; im.src = url; });
  const pixels = im => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, W, H).data; };

  async function init() {
    const [a, b] = await Promise.all([load(p.src), load(p.rmap)]);
    const src = pixels(a), map = pixels(b);
    out = ctx.createImageData(W, H); out.data.set(src);
    const list = [], al = [], r = [];
    for (let i = 0; i < W * H; i++) {
      out.data[i * 4 + 3] = 0;
      if (!src[i * 4 + 3]) continue;
      list.push(i * 4 + 3); al.push(src[i * 4 + 3]); r.push(map[i * 4] / 127);
    }
    idx = Uint32Array.from(list); srcA = Float32Array.from(al); rmap = Float32Array.from(r);
    ctx.putImageData(out, 0, 0);
  }
  function draw(open) {
    if (!rmap || Math.abs(open - last) < 0.004) return;
    last = open;
    const oo = open * 1.35, d = out.data;
    for (let k = 0; k < idx.length; k++) {
      let t = (oo - rmap[k]) / 0.15;
      d[idx[k]] = srcA[k] * (t < 0 ? 0 : t > 1 ? 1 : t);
    }
    ctx.putImageData(out, 0, 0);
  }
  return { init, draw };
})();

// =====================================================================
// 声：voice/ の音声ファイル（VOICEVOX）を再生。無いセリフはブラウザの読み上げで代用
// =====================================================================
const Voice = (() => {
  let lines = {}, files = {}, actx = null, analyser = null, buf = null, node = null, cache = new Map();
  let muted = store.get('kuro-muted', false);
  const bubble = $('bubble');
  let bubbleTimer = 0;

  async function load() {
    try { lines = (await (await fetch('serifu.json')).json()).lines; } catch { lines = {}; }
    try { files = await (await fetch('voice/index.json', { cache: 'no-cache' })).json(); } catch { files = {}; }
  }

  // スタートボタンなど、最初の操作のときに呼ぶ（スマホは操作しないと音が出せない）
  function unlock() {
    if (!actx) {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = actx.createAnalyser(); analyser.fftSize = 1024;
      analyser.connect(actx.destination);
      buf = new Float32Array(analyser.fftSize);
    }
    if (actx.state !== 'running') actx.resume();
    // 全部の音声を裏で読み込んでおく
    for (const id of Object.keys(files)) getBuffer(id).catch(() => {});
  }

  function getBuffer(id) {
    if (!cache.has(id)) {
      cache.set(id, fetch('voice/' + files[id]).then(r => r.arrayBuffer()).then(a => actx.decodeAudioData(a)));
    }
    return cache.get(id);
  }

  function choose(group, n) {
    let list = lines[group] || [];
    if (group === 'today') {
      const m = list.filter(l => l.n === n);
      list = m.length ? m : list.filter(l => l.n === 99);
    }
    return list.length ? pick(list) : null;
  }

  function showBubble(text, ms) {
    bubble.textContent = text; bubble.hidden = false;
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => { bubble.hidden = true; }, Math.max(2500, ms + 800));
  }

  function stop() {
    if (node) { try { node.stop(); } catch {} node.disconnect(); node = null; }
    TTS.stop();
  }

  async function say(group, n) {
    const line = choose(group, n);
    if (!line) return;
    stop();
    // 声なし、またはまだ一度も操作してなくて音が出せないときは吹き出しだけ
    if (muted || (files[line.id] && !actx)) { showBubble(line.text, 0); return; }
    if (files[line.id] && actx) {
      try {
        const b = await getBuffer(line.id);
        stop();
        node = actx.createBufferSource(); node.buffer = b; node.connect(analyser);
        node.onended = () => { node = null; };
        node.start();
        showBubble(line.text, b.duration * 1000);
        return;
      } catch { /* 読めなかったら下の読み上げで代用 */ }
    }
    showBubble(line.text, line.text.length * 160);
    TTS.speak(line.text);
  }

  function level(now) {
    if (node) {
      analyser.getFloatTimeDomainData(buf);
      let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      return Math.max(0, Math.min(1, (Math.sqrt(s / buf.length) - 0.01) / 0.08));
    }
    return TTS.level(now);
  }

  function setMuted(m) { muted = m; store.set('kuro-muted', m); if (m) stop(); }
  return { load, unlock, say, level, setMuted, get muted() { return muted; } };
})();

// ブラウザの読み上げ（音声ファイルがまだ無いときの代用）。音量が取れないので時間割で口を動かす
const TTS = (() => {
  const synth = window.speechSynthesis;
  let voice = null, tl = null, start = 0, speaking = false, cur = 0;
  function pickVoice() {
    const v = synth.getVoices().filter(v => /^ja/i.test(v.lang));
    voice = v.find(x => /(Kyoko|Nanami|Google)/i.test(x.name)) || v[0] || null;
  }
  if (synth) { pickVoice(); synth.onvoiceschanged = pickVoice; }

  function timeline(text, rate) {
    const mora = 150 / rate, segs = []; let t = 0;
    const ext = d => { if (segs.length) { segs[segs.length - 1].d += d; t += d; } };
    for (const c of text) {
      if ('、,'.includes(c)) { t += 260 / rate; continue; }
      if ('。！？!?…'.includes(c)) { t += 420 / rate; continue; }
      if ('ゃゅょっぁぃぅぇぉャュョッァィゥェォ'.includes(c)) { ext(mora * 0.5); continue; }
      if ('ー〜～'.includes(c)) { ext(mora); continue; }
      if (/[\s「」『』（）()]/.test(c)) continue;
      for (let n = /[一-鿿]/.test(c) ? 1.7 : /[A-Za-z0-9]/.test(c) ? 0.6 : 1; n > 0.05; n -= 1) {
        const d = mora * Math.min(1, n); segs.push({ s: t, d, a: 0.6 + Math.random() * 0.4 }); t += d;
      }
    }
    return { segs, end: t };
  }
  function speak(text) {
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[〜～]/g, 'ー'));
    u.lang = 'ja-JP'; u.rate = 1.05; u.pitch = 1.15; if (voice) u.voice = voice;
    tl = timeline(text, u.rate); speaking = false;
    const begin = () => { speaking = true; start = performance.now(); cur = 0; };
    u.onstart = begin;
    u.onend = u.onerror = () => { speaking = false; };
    synth.speak(u);
    setTimeout(() => { if (!speaking && synth.speaking) begin(); }, 400);
  }
  function stop() { if (synth && (synth.speaking || synth.pending)) synth.cancel(); speaking = false; }
  function level(now) {
    if (!speaking || !tl) return 0;
    const e = now - start;
    if (e > tl.end) return Math.max(0, Math.sin(e / 50)) * 0.6;
    while (cur < tl.segs.length && e >= tl.segs[cur].s + tl.segs[cur].d) cur++;
    const g = tl.segs[cur];
    return !g || e < g.s ? 0 : g.a * Math.pow(Math.sin(Math.PI * (e - g.s) / g.d), 0.7);
  }
  return { speak, stop, level };
})();

// =====================================================================
// タイマー
//   終わる時刻(endAt)を覚えておく方式なので、アプリを閉じてても時間はずれない。
//   作業が終わったら休憩は自動で始まり、休憩が終わったら「スタート」待ちになる。
// =====================================================================
const Timer = (() => {
  const today = () => new Date().toLocaleDateString('sv');   // YYYY-MM-DD
  let s = Object.assign({
    phase: 'idle',      // idle | work | short | long | ready
    running: false,
    endAt: 0,           // 動いているときの終了時刻
    remain: DUR.work,   // 止まっているときの残り時間
    cycle: 0,           // 今のセットで終わった作業の回数（0〜3）
    date: today(),
    count: 0,           // 今日終わった作業の回数
  }, store.get(CONFIG.storageKey, {}));

  const save = () => store.set(CONFIG.storageKey, s);
  const isRest = () => s.phase === 'short' || s.phase === 'long';
  const total = () => DUR[isRest() ? s.phase : 'work'];
  function rollDate() { if (s.date !== today()) { s.date = today(); s.count = 0; } }

  // 時間が来たフェーズを進める。最後に起きた切り替えのセリフを返す
  function catchUp(now) {
    let said = null;
    while (s.running && now >= s.endAt) {
      if (s.phase === 'work') {
        rollDate();
        s.count++; s.cycle++;
        const long = s.cycle >= CONFIG.longEvery;
        if (long) s.cycle = 0;
        s.phase = long ? 'long' : 'short';
        s.endAt += DUR[s.phase];
        said = [s.phase === 'long' ? 'break_long' : 'break_short'];
      } else {
        s.phase = 'ready'; s.running = false; s.remain = DUR.work;
        said = ['break_end'];
      }
    }
    if (said) save();
    return said;
  }

  function start() {
    rollDate();
    s.phase = 'work'; s.running = true; s.endAt = Date.now() + DUR.work;
    save(); return ['start'];
  }
  function pause() { s.remain = Math.max(0, s.endAt - Date.now()); s.running = false; save(); return ['pause']; }
  function resume() { s.endAt = Date.now() + s.remain; s.running = true; save(); return ['resume']; }
  function main() {
    if (s.phase === 'idle' || s.phase === 'ready') return start();
    return s.running ? pause() : resume();
  }
  function endBreak() { s.phase = 'ready'; s.running = false; s.remain = DUR.work; save(); return ['break_end']; }
  function reset() { s.phase = 'idle'; s.running = false; s.remain = DUR.work; s.cycle = 0; save(); }

  function remaining(now) { return s.running ? Math.max(0, s.endAt - now) : s.remain; }
  return { get s() { rollDate(); return s; }, isRest, total, catchUp, main, endBreak, reset, remaining };
})();

// =====================================================================
// 画面の更新と操作
// =====================================================================
const ui = {
  phase: $('phase'), time: $('time'), ring: $('ring'), dots: [...$('dots').children],
  main: $('mainBtn'), skip: $('skipBtn'), reset: $('resetBtn'), today: $('today'), mute: $('muteBtn'),
};
const LABEL = { idle: '作業', ready: 'つぎの作業', work: '作業中', short: '休憩', long: '長い休憩' };
const fmt = ms => { const t = Math.ceil(ms / 1000); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };

let lastText = '';
function render(now) {
  const s = Timer.s, rest = Timer.isRest();
  const remain = Timer.remaining(now);
  const text = fmt(remain);
  if (text !== lastText) {
    lastText = text;
    ui.time.textContent = text;
    document.title = (s.running || s.phase === 'work' ? text + ' ' : '') + 'クロ ポモドーロ';
  }
  ui.ring.style.strokeDashoffset = (100 * (1 - remain / Timer.total())).toFixed(2);
  document.body.classList.toggle('is-rest', rest);
  ui.phase.textContent = LABEL[s.phase] + (s.phase === 'work' && !s.running ? '（一時停止）' : '');
  ui.main.textContent = s.phase === 'idle' || s.phase === 'ready' ? 'スタート' : s.running ? '一時停止' : '再開';
  ui.main.hidden = rest;
  ui.skip.hidden = !rest;
  ui.reset.hidden = !(s.phase === 'work' && !s.running);
  ui.dots.forEach((d, i) => d.classList.toggle('on', i < s.cycle));
  ui.today.textContent = s.count;
}

function act(result) {
  Voice.unlock();
  if (result) Voice.say(...result);
  WakeLock.sync();
  render(Date.now());
}
ui.main.onclick = () => act(Timer.main());
ui.skip.onclick = () => act(Timer.endBreak());
ui.reset.onclick = () => { Timer.reset(); act(null); };
ui.today.parentElement.onclick = () => act(['today', Timer.s.count]);
$('stage').onclick = () => act(['tap']);
function renderMute() {
  ui.mute.textContent = Voice.muted ? '🔇 声なし' : '🔈 声あり';
  ui.mute.setAttribute('aria-pressed', String(Voice.muted));
}
ui.mute.onclick = () => { Voice.setMuted(!Voice.muted); renderMute(); };
renderMute();

// 画面がスリープしないように（タイマーが動いていて、画面が見えている間だけ）
const WakeLock = (() => {
  let lock = null;
  async function sync() {
    const want = Timer.s.running && document.visibilityState === 'visible';
    try {
      if (want && !lock && navigator.wakeLock) { lock = await navigator.wakeLock.request('screen'); lock.onrelease = () => { lock = null; }; }
      else if (!want && lock) { await lock.release(); lock = null; }
    } catch { lock = null; }
  }
  document.addEventListener('visibilitychange', sync);
  return { sync };
})();

// =====================================================================
// まばたき・揺れ・口パク（毎フレーム）
// =====================================================================
const blink = (() => {
  let next = performance.now() + 2500, at = -1;
  return t => {
    if (at < 0 && t >= next) { at = t; next = Math.random() < 0.18 ? t + 260 : t + 2500 + Math.random() * 3500; }
    if (at < 0) return 0;
    const e = t - at;
    if (e < 50) return e / 50; if (e < 120) return 1; if (e < 200) return 1 - (e - 120) / 80;
    at = -1; return 0;
  };
})();

const t0 = performance.now();
let last = t0, open = 0, env = 0, lastEye = -1;
function loop(t) {
  const dt = Math.min(50, t - last) / 16.7; last = t;
  const now = Date.now();

  const said = Timer.catchUp(now);
  if (said) { Voice.say(...said); WakeLock.sync(); }

  const target = Voice.level(t);
  open += (target - open) * (1 - Math.pow(1 - (target > open ? 0.45 : 0.22), dt));
  env += (open - env) * (1 - Math.pow(0.9, dt));
  Mouth.draw(open);

  const eye = blink(t);
  if (eye !== lastEye) { Scene.els.eyes.style.opacity = eye; lastEye = eye; }

  const sec = (t - t0) / 1000;
  const breathe = Math.sin(sec * 1.6) * 0.35;
  const sway = Math.sin(sec * 0.8) * 0.35 + Math.sin(sec * 1.9) * 0.1;
  Scene.char.style.transform =
    `translateY(${(1.6 - breathe - env - open * 0.3).toFixed(3)}%) rotate(${(sway + env * 0.35).toFixed(3)}deg) scale(1.01)`;

  render(now);
  requestAnimationFrame(loop);
}

Promise.all([Mouth.init(), Voice.load()]).finally(() => requestAnimationFrame(loop));

// オフラインでも開けるように（https か localhost のときだけ）
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
