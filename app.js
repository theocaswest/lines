/* Lines — a tiny script rehearsal app. No build step, no network, all local. */
(function () {
  'use strict';

  /* ───────────────────────────── helpers ───────────────────────────── */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);

  const LS_KEY = 'lines.play.v1';
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const now = () => Date.now();

  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /* ───────────────────────────── state ───────────────────────────── */

  function defaultSettings() {
    return {
      mode: 'rehearse',
      rate: 1,
      autoSpeak: true,
      speakDirections: false,
      voiceMap: {},
      fullScene: false,
      scene: 'all',
      troubleOnly: false
    };
  }

  function blankState() {
    return {
      v: 1,
      title: '',
      raw: '',
      character: '',
      lines: [],
      scenes: [{ label: 'Open' }],
      actors: {},
      progress: {},
      settings: defaultSettings()
    };
  }

  let S = blankState();

  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(S));
    } catch (e) {
      /* private mode / quota — app still works for this session */
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return false;
      const o = JSON.parse(raw);
      if (!o || o.v !== 1 || !Array.isArray(o.lines)) return false;
      S = Object.assign(blankState(), o);
      S.settings = Object.assign(defaultSettings(), o.settings || {});
      S.progress = o.progress || {};
      S.scenes = Array.isArray(o.scenes) && o.scenes.length ? o.scenes : [{ label: 'Open' }];
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ───────────────────────────── parser ───────────────────────────── */

  const DIRECTION_RE = /^(?:\(.*\)|\[.*\])$/;
  const SCENE_RE = /^(?:ACT|SCENE|PART)\s+(?:[IVXLCDM]+|\d+|ONE|TWO|THREE|FOUR|FIVE)\b[.:\u2014-]?\s*(.*)$/i;
  const SKIP_NAMES = /^(ACT|SCENE|THE END|END|CURTAIN|BLACKOUT|PROLOGUE|EPILOGUE|INTERMISSION|TITLE|FINIS)$/i;
  const ROLE_STOP = /^(SONG|SCENE|ACT|PART|CD|TRACK|SFX|THE|END|CURTAIN|BLACKOUT|MUSIC|LIGHTS|PROLOGUE|EPILOGUE|INTERMISSION|TITLE|FINIS|NOTE)$/i;

  function tidyName(name) {
    let n = name.replace(/\s+/g, ' ').trim();
    // ALL CAPS names read better in title case
    if (/^[A-Z0-9 .,'\u2019-]+$/.test(n) && /[A-Z]{2}/.test(n)) {
      n = n.toLowerCase().replace(/(^|[\s.'\u2019-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
    }
    return n;
  }

  function isCapsName(t) {
    if (t.length > 34) return false;
    if (!/^[A-Z0-9][A-Z0-9 .,'\u2019-]*$/.test(t)) return false;
    if (/[.,;:!?]$/.test(t)) return false;
    if (t.split(/\s+/).length > 4) return false;
    if (!/[A-Z]{2}/.test(t)) return false;
    if (SKIP_NAMES.test(t)) return false;
    return true;
  }

  function nextNonEmpty(src, from) {
    for (let i = from + 1; i < src.length; i++) {
      const t = src[i].replace(/\s+/g, ' ').trim();
      if (t) return t;
    }
    return null;
  }

  /**
   * Reads a name-column cell such as "SCROOGE Henry P" or "NARRATOR 5 Theo".
   * Leading ALL-CAPS words are the role; the title-case tail is the actor
   * playing it, which is handy in school scripts.
   */
  function speakerCell(cell) {
    const s = String(cell).trim().replace(/\s+/g, ' ');
    if (!s || s.length > 44) return null;
    if (!/^[A-Z0-9]/.test(s)) return null;
    const words = s.split(' ');
    if (words.length > 5) return null;

    let i = 0;
    while (i < words.length) {
      const w = words[i];
      if (!/^[A-Z0-9][A-Z0-9'’.\-&]*$/.test(w)) break;
      if (w.length === 1 && !/\d/.test(w)) break;   // a lone initial belongs to the actor
      i++;
    }
    if (!i) return null;

    const role = words.slice(0, i).join(' ');
    if (ROLE_STOP.test(role.split(' ')[0])) return null;

    const actor = words.slice(i).join(' ');
    if (!actor) return { role: tidyName(role), actor: '' };
    if (!/^[A-Z]/.test(actor) || actor.split(' ').length > 3) return null;

    return { role: tidyName(role), actor: tidyName(actor) };
  }

  /**
   * Understands the shapes stage scripts usually arrive in:
   *    HAMLET: To be or not to be          (inline)
   *    HAMLET                              (name on its own line)
   *    To be or not to be
   *    SCROOGE Henry P    Home at last.    (name column + actor, as in school scripts)
   * plus ACT / SCENE headings and (stage directions).
   */
  function parseScript(rawText) {
    const src = String(rawText || '').replace(/\r\n?/g, '\n').split('\n');
    const scenes = [{ label: 'Opening' }];
    const canon = new Map();
    const actors = {};
    const out = [];
    let sceneIdx = 0;
    let speaker = null;
    let gutter = false; // document uses a name column

    const canonName = (name) => {
      const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (canon.has(key)) return canon.get(key);
      const t = tidyName(name);
      canon.set(key, t);
      return t;
    };

    for (let i = 0; i < src.length; i++) {
      const rawLine = src[i];
      const t = rawLine.replace(/\s+/g, ' ').trim();
      const indented = /^[ \t]/.test(rawLine);
      if (!t) { speaker = null; continue; }

      const sceneMatch = t.match(SCENE_RE);
      if (sceneMatch && t.length <= 80) {
        sceneIdx++;
        const label = t.replace(/[.:]\s*$/, '');
        scenes.push({ label });
        speaker = null;
        continue;
      }

      if (DIRECTION_RE.test(t)) {
        out.push({ type: 'direction', speaker: null, text: t, scene: sceneIdx });
        continue;
      }

      // name column: "SCROOGE Henry P      (Reaching the door) Home at last."
      const gap = indented ? null : rawLine.match(/^(\S.*?)(?:\t|\s{2,})(\S.*)$/);
      if (gap) {
        const cell = speakerCell(gap[1]);
        if (cell) {
          const name = canonName(cell.role);
          if (cell.actor) actors[name] = cell.actor;
          out.push({ type: 'dialogue', speaker: name, text: gap[2].trim(), scene: sceneIdx });
          speaker = name;
          gutter = true;
          continue;
        }
      }

      const inline = t.match(/^([A-Z][A-Za-z0-9 .,'\u2019-]{0,29}?)\s*:\s*(.+)$/);
      if (inline && inline[1].trim().split(/\s+/).length <= 4) {
        const name = canonName(inline[1]);
        out.push({ type: 'dialogue', speaker: name, text: inline[2].trim(), scene: sceneIdx });
        speaker = name;
        continue;
      }

      if (!indented && !gutter && isCapsName(t)) {
        const after = nextNonEmpty(src, i);
        if (after && !DIRECTION_RE.test(after)) {
          speaker = canonName(t);
          continue;
        }
      }

      if (speaker && (indented || !gutter)) {
        const last = out[out.length - 1];
        if (last && last.type === 'dialogue' && last.speaker === speaker && last.scene === sceneIdx) {
          last.text += ' ' + t;          // wrapped line inside one speech
        } else {
          out.push({ type: 'dialogue', speaker, text: t, scene: sceneIdx });
        }
        continue;
      }

      out.push({ type: 'direction', speaker: null, text: t, scene: sceneIdx });
      if (gutter) speaker = null;
    }

    // stable-ish ids so re-importing an edited script keeps progress
    const seen = new Map();
    out.forEach((l, i) => {
      let base = hash((l.speaker || '~') + '|' + l.text.toLowerCase().replace(/\s+/g, ' '));
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      l.id = n > 1 ? base + '-' + n : base;
      l.index = i;
    });

    // prune empty scenes
    const used = new Set(out.map((l) => l.scene));
    const kept = scenes.filter((s, i) => used.has(i));
    if (kept.length !== scenes.length) {
      const remap = new Map();
      let next = 0;
      scenes.forEach((s, i) => { if (used.has(i)) remap.set(i, next++); });
      out.forEach((l) => { l.scene = remap.get(l.scene); });
      scenes.length = 0;
      scenes.push(...kept);
    }

    return { lines: out, scenes, actors };
  }

  function charactersOf(lines) {
    const counts = new Map();
    lines.forEach((l) => {
      if (l.type === 'dialogue' && l.speaker) counts.set(l.speaker, (counts.get(l.speaker) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([name, n]) => ({ name, n, actor: (S.actors && S.actors[name]) || '' }))
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  }

  const myLines = () => S.lines.filter((l) => l.type === 'dialogue' && l.speaker === S.character);
  const lineIndex = (id) => S.lines.findIndex((l) => l.id === id);
  const lineById = (id) => S.lines.find((l) => l.id === id);

  /* ───────────────────────────── speech ───────────────────────────── */

  const speechOK = typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined';
  let voices = [];
  let voiceKey = '';

  function refreshVoices() {
    if (!speechOK) return;
    const v = speechSynthesis.getVoices();
    const key = v.map((x) => x.voiceURI).join(',');
    if (!v.length || key === voiceKey) return;
    voiceKey = key;
    voices = v;
    renderAllVoices();
  }

  function preferredVoices() {
    const en = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
    return en.length ? en : voices;
  }

  const PITCH_CACHE = {};
  function pitchFor(name) {
    if (PITCH_CACHE[name] == null) PITCH_CACHE[name] = 0.86 + (Math.abs(parseInt(hash(name), 36)) % 7) * 0.045;
    return PITCH_CACHE[name];
  }

  function voiceFor(name) {
    const uri = S.settings.voiceMap[name];
    return (uri && voices.find((v) => v.voiceURI === uri)) || null;
  }

  function spoken(text) {
    return String(text)
      .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
      .replace(/[\u2014\u2013]/g, ', ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function speak(text, speaker) {
    if (!speechOK) return;
    const clean = spoken(text);
    if (!clean) return;
    const u = new SpeechSynthesisUtterance(clean);
    const v = speaker ? voiceFor(speaker) : null;
    if (v) u.voice = v;
    u.rate = S.settings.rate;
    u.pitch = speaker ? pitchFor(speaker) : 1;
    u.volume = 1;
    speechSynthesis.speak(u);
  }

  function stopSpeech() {
    if (speechOK) speechSynthesis.cancel();
  }

  function ensureVoices() {
    const list = preferredVoices();
    if (!list.length) return;
    charactersOf(S.lines).forEach((c, i) => {
      if (!S.settings.voiceMap[c.name]) S.settings.voiceMap[c.name] = list[i % list.length].voiceURI;
    });
    save();
  }

  /* ───────────────────────────── views ───────────────────────────── */

  const views = ['import', 'cast', 'practice', 'stats'];
  let currentView = 'import';

  function show(name) {
    const prev = currentView;
    currentView = name;
    window.scrollTo({ top: 0, behavior: 'auto' });
    views.forEach((v) => {
      const el = $('#view-' + v);
      if (el) el.classList.toggle('on', v === name);
    });
    renderTopbar();
    if (name === 'import' && prev !== 'import') prefillImport();
    if (name === 'cast') renderCast();
    if (name === 'practice') { rebuild(); }
    if (name === 'stats') renderStats();
  }

  function renderTopbar() {
    const mid = $('#topbarMid');
    const nav = $('#topbarNav');
    document.title = S.title ? S.title + ' — Lines' : 'Lines — learn your part';
    if (!S.lines.length) {
      mid.innerHTML = '';
      nav.innerHTML = '';
      return;
    }
    mid.innerHTML =
      '<span class="chip">' + esc(S.title || 'Untitled play') + '</span>' +
      (S.character ? '<span class="chip accent">You: ' + esc(S.character) + '</span>' : '');

    const items = [
      ['practice', 'Rehearse'],
      ['stats', 'Progress'],
      ['import', 'Script']
    ];
    nav.innerHTML = items
      .map(([v, label]) => '<button class="navlink' + (v === currentView ? ' on' : '') + '" data-nav="' + v + '">' + label + '</button>')
      .join('');
  }

  /* ───────────────────────────── import ───────────────────────────── */

  const SAMPLE = [
    'SCENE 2 — THE AUDITION',
    '',
    'MARLOWE: You’re late. The whole panel is waiting.',
    '',
    'JUNE: The bus broke down. I ran the last six blocks.',
    '',
    'MARLOWE: (looking her up and down) Then you’d better be worth the wait.',
    '',
    'JUNE: I’ve had the sides for three days. I know every word.',
    '',
    'MARLOWE: Everyone says that. Very few mean it.',
    '',
    'JUNE: Then let me start before I forget how to breathe.',
    '',
    'MARLOWE: Whenever you’re ready.',
    '',
    'JUNE: The door was open, so I walked in. That’s all. I didn’t touch a thing, I didn’t take a thing, and I would have said so if anyone had asked me.',
    '',
    'MARLOWE: Nobody asked you.',
    '',
    'JUNE: That’s exactly my point.'
  ].join('\n');

  function prefillImport() {
    $('#titleInput').value = S.title || '';
    $('#scriptInput').value = S.raw || '';
    $('#btnClear').hidden = !S.lines.length;
    $('#importErr').textContent = '';
  }

  function handleParse() {
    const raw = $('#scriptInput').value;
    const title = $('#titleInput').value.trim();
    const err = $('#importErr');
    err.textContent = '';

    if (!raw.trim()) {
      err.textContent = 'Paste your script first.';
      return;
    }

    const { lines, scenes, actors } = parseScript(raw);
    const chars = charactersOf(lines);

    if (!lines.length) {
      err.textContent = 'No lines found. Try putting each speech on its own line, like “HAMLET: To be…”';
      return;
    }
    if (!chars.length) {
      err.textContent = 'Found text, but no character names. Try “NAME: line” on each speech.';
      return;
    }

    const previousCharacter = S.character;
    S.raw = raw;
    S.title = title;
    S.lines = lines;
    S.scenes = scenes;
    S.actors = actors;
    S.character = chars.some((c) => c.name === previousCharacter) ? previousCharacter : '';
    S.settings.scene = 'all';
    ensureVoices();
    save();

    show('cast');
  }

  /* ───────────────────────────── cast ───────────────────────────── */

  function renderCast() {
    const chars = charactersOf(S.lines);
    const total = myLines().length;

    $('#castSummary').textContent =
      (S.title ? S.title + ' · ' : '') +
      S.lines.filter((l) => l.type === 'dialogue').length + ' speeches · ' +
      chars.length + ' characters' +
      (S.character ? ' · ' + total + ' lines are yours' : '');

    $('#charChips').innerHTML = chars
      .map((c) =>
        '<button class="chipbtn' + (c.name === S.character ? ' on' : '') + '" data-char="' + esc(c.name) + '">' +
        esc(c.name) +
        '<span class="n">' + (c.actor ? esc(c.actor) + ' · ' : '') + c.n + '</span></button>'
      )
      .join('');

    renderAllVoices();
    $('#btnStart').disabled = !S.character;
  }

  function voiceRowHTML(name) {
    const list = voices.length ? voices : [];
    const assigned = S.settings.voiceMap[name] || '';
    const opts = ['<option value="">System default</option>']
      .concat(
        list.map(
          (v) =>
            '<option value="' + esc(v.voiceURI) + '"' + (v.voiceURI === assigned ? ' selected' : '') + '>' +
            esc(v.name) + ' · ' + esc(v.lang) + '</option>'
        )
      )
      .join('');
    return (
      '<div class="voice-row">' +
      '<span class="who' + (name === S.character ? ' me' : '') + '">' + esc(name) + '</span>' +
      '<select data-voice-for="' + esc(name) + '" aria-label="Voice for ' + esc(name) + '">' + opts + '</select>' +
      '<button class="icon-btn" data-test-voice="' + esc(name) + '" title="Hear this voice" aria-label="Hear ' + esc(name) + '">▶</button>' +
      '</div>'
    );
  }

  function renderAllVoices() {
    const chars = charactersOf(S.lines).map((c) => c.name);
    const html = chars.length
      ? chars.map(voiceRowHTML).join('')
      : '<p class="empty">No characters yet.</p>';
    ['#castVoices', '#dlgVoices'].forEach((sel) => {
      const el = $(sel);
      if (el) el.innerHTML = html;
    });
  }

  /* ───────────────────────────── practice ───────────────────────────── */

  const P = {
    queue: [],
    idx: 0,
    reveal: 0,          // 0 hidden · 1 first letters · 2 full
    typed: '',
    checked: false,
    diff: null,
    score: 0,
    finished: false,
    session: { ok: 0, miss: 0 }
  };

  function isTrouble(id) {
    const p = S.progress[id];
    return !!p && p.miss > 0 && (p.streak || 0) < 2;
  }

  function buildQueue(reset) {
    let queue = myLines();
    if (S.settings.scene !== 'all') queue = queue.filter((l) => String(l.scene) === String(S.settings.scene));
    if (S.settings.troubleOnly) queue = queue.filter((l) => isTrouble(l.id));
    P.queue = queue.map((l) => l.id);
    if (reset) {
      P.idx = 0;
      P.finished = false;
      P.session = { ok: 0, miss: 0 };
    }
    if (P.idx >= P.queue.length) P.idx = Math.max(0, P.queue.length - 1);
    P.reveal = 0;
    P.typed = '';
    P.checked = false;
    P.diff = null;
  }

  function rebuild() {
    if (!S.lines.length) { show('import'); return; }
    if (!S.character) { show('cast'); return; }
    buildQueue(true);
    renderSceneOptions();
    renderPractice();
  }

  function renderSceneOptions() {
    const counts = new Map();
    myLines().forEach((l) => counts.set(l.scene, (counts.get(l.scene) || 0) + 1));
    const ids = Array.from(counts.keys()).sort((a, b) => a - b);
    const sel = $('#sceneSel');
    sel.innerHTML =
      '<option value="all">All scenes</option>' +
      ids
        .map((i) => {
          const label = (S.scenes[i] && S.scenes[i].label) || 'Scene ' + (i + 1);
          return '<option value="' + i + '">' + esc(label) + '</option>';
        })
        .join('');
    sel.value = S.settings.scene === 'all' ? 'all' : String(S.settings.scene);
    if (sel.value !== String(S.settings.scene) && S.settings.scene !== 'all') {
      S.settings.scene = 'all';
      sel.value = 'all';
    }
  }

  const fmtSay = (t) => esc(t).replace(/(\([^)]*\)|\[[^\]]*\])/g, '<em>$1</em>');

  function hintText(t) {
    return String(t).split(/(\s+)/).map((tok) => {
      if (/^\s+$/.test(tok) || !tok) return tok;
      const m = tok.match(/^([^A-Za-z0-9]*)([A-Za-z0-9'\u2019]*)([^A-Za-z0-9]*)$/);
      if (!m) return esc(tok);
      const [, lead, core, trail] = m;
      if (core.length <= 1) return esc(tok);
      return esc(lead) + esc(core[0]) + '<span class="dot">' + '·'.repeat(Math.min(core.length - 1, 7)) + '</span>' + esc(trail);
    }).join('');
  }

  function lineHTML(l, opts) {
    opts = opts || {};
    const isMine = l.type === 'dialogue' && l.speaker === S.character;
    const cls = ['ln'];
    if (opts.dim) cls.push('dim');
    if (isMine) cls.push('mine');

    if (l.type === 'direction') {
      return '<div class="' + cls.join(' ') + ' dir"><span class="who"></span><span class="say">' + fmtSay(l.text) + '</span></div>';
    }

    let say = fmtSay(l.text);
    if (isMine && opts.current) {
      if (P.reveal === 1) say = '<span class="hint-line">' + hintText(l.text) + '</span>';
      else if (P.reveal === 0) say = '<span class="blurred">' + say + '</span>';
    }
    return (
      '<div class="' + cls.join(' ') + '">' +
      '<span class="who">' + esc(l.speaker || '') + '</span>' +
      '<span class="say">' + say + '</span>' +
      '</div>'
    );
  }

  function contextRange(line) {
    const li = lineIndex(line.id);
    let start = li;
    let end = li;
    for (let i = li; i >= 0; i--) { if (S.lines[i].scene !== line.scene) break; start = i; }
    for (let i = li; i < S.lines.length; i++) { if (S.lines[i].scene !== line.scene) break; end = i; }
    return { start, end, li };
  }

  function cueLinesFor(line) {
    const li = lineIndex(line.id);
    const out = [];
    for (let i = li - 1; i >= 0 && out.length < 4; i--) {
      const l = S.lines[i];
      if (l.type === 'dialogue' && l.speaker === S.character) break;
      if (l.type === 'direction' && !S.settings.speakDirections) continue;
      if (!l.speaker) continue;
      out.unshift(l);
    }
    return out;
  }

  function renderPractice() {
    const stage = $('#stage');
    const controls = $('#controls');
    const keys = $('#keys');
    const total = P.queue.length;

    $$('#modeSeg button').forEach((b) => {
      const on = b.dataset.mode === S.settings.mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('#troubleOnly').checked = !!S.settings.troubleOnly;
    $('#fullScene').checked = !!S.settings.fullScene;

    $('#pgCount').textContent = total ? (P.finished ? total : Math.min(P.idx + 1, total)) + ' / ' + total : '0 / 0';
    $('#pgBar').style.width = total ? ((P.finished ? total : P.idx + 1) / total) * 100 + '%' : '0%';

    if (!total) {
      const reason = S.settings.troubleOnly
        ? 'No trouble lines in this scene — nothing to drill.'
        : 'You have no lines in this scene.';
      stage.innerHTML = '<div class="done"><h2>Nothing here yet</h2><p class="lede">' + esc(reason) + '</p></div>';
      controls.innerHTML = S.settings.troubleOnly
        ? '<button class="btn ghost" data-act="clear-trouble">Show all my lines</button>'
        : '<button class="btn ghost" data-act="pick-character">Choose a different character</button>';
      keys.textContent = '';
      return;
    }

    if (P.finished) {
      renderFinished(stage, controls, keys);
      return;
    }

    const line = lineById(P.queue[P.idx]);
    if (!line) { P.idx = 0; return renderPractice(); }

    const { start, end, li } = contextRange(line);
    let html = '';

    if (S.settings.fullScene) {
      const before = [];
      for (let i = start; i < li; i++) before.push(lineHTML(S.lines[i], { dim: true }));
      const mineHTML =
        '<div class="mypart script-mode" data-act="reveal">' +
        '<div class="ln mine"><span class="who">' + esc(line.speaker) + '</span>' +
        '<span class="say">' + inlineSay(line) + '</span></div>' +
        '</div>';
      const after = [];
      for (let i = li + 1; i <= end; i++) after.push(lineHTML(S.lines[i], { dim: true }));
      html = before.join('') + mineHTML + after.join('');
    } else {
      const from = Math.max(start, li - 5);
      const ctx = [];
      for (let i = from; i < li; i++) ctx.push(lineHTML(S.lines[i], { dim: true }));
      html = ctx.join('') + (S.settings.mode === 'type' ? '' : myPartHTML(line));
    }

    if (S.settings.mode === 'type') html += typeBlockHTML();

    stage.innerHTML = html;
    controls.innerHTML = S.settings.mode === 'type' ? typeControlsHTML() : rehearseControlsHTML();
    keys.innerHTML = shortcutLegend();

    if (S.settings.fullScene) {
      const cur = $('.mypart.script-mode');
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    } else {
      const card = $('.mypart');
      if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }

    if (S.settings.mode === 'type') {
      const ta = $('#answerBox');
      if (ta && !P.checked) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    }
  }

  function inlineSay(line) {
    if (P.reveal === 2) return fmtSay(line.text);
    if (P.reveal === 1) return '<span class="hint-line">' + hintText(line.text) + '</span>';
    return '<span class="blurred">' + fmtSay(line.text) + '</span>';
  }

  function myPartHTML(line) {
    return (
      '<div class="mypart" data-act="reveal">' +
      '<div class="tag">Your line</div>' +
      '<p class="say">' + inlineSay(line) + '</p>' +
      (P.reveal === 0
        ? '<span class="tap">Tap the line, or press <kbd>space</kbd> to check yourself</span>'
        : '') +
      '</div>'
    );
  }

  function typeBlockHTML() {
    const line = lineById(P.queue[P.idx]);
    let html = '<div class="mypart type-mode"><div class="tag">Your line</div>';

    if (P.checked) {
      html += '<div class="diff" aria-label="Comparison">' + diffHTML(P.diff) + '</div>';
      html += scoreLineHTML();
    } else {
      if (P.reveal === 2) html += '<p class="say given">' + fmtSay(line.text) + '</p>';
      html +=
        '<textarea id="answerBox" class="answer" placeholder="Type the line from memory…" spellcheck="false" ' +
        'autocapitalize="off" autocomplete="off" autocorrect="off">' + esc(P.typed) + '</textarea>';
      html +=
        '<span class="tap">' + normWords(line.text).length + ' words · <kbd>enter</kbd> to check</span>';
    }

    html += '</div>';
    return html;
  }

  function scoreLineHTML() {
    const pct = Math.round(P.score * 100);
    const cls = pct >= 95 ? 'good' : pct >= 70 ? 'mid' : 'bad';
    const verdict = pct >= 95 ? 'Word perfect' : pct >= 70 ? 'Nearly there' : 'Keep drilling';
    return (
      '<div class="score-line">' +
      '<span class="score-pill ' + cls + '">' + pct + '%</span>' +
      '<span>' + verdict + '</span>' +
      '</div>'
    );
  }

  function rehearseControlsHTML() {
    const last = P.idx === 0;
    if (P.reveal < 2) {
      return (
        '<button class="btn primary" data-act="reveal">' +
        (P.reveal === 0 ? 'Reveal line' : 'Show full line') +
        '</button>' +
        (P.reveal === 0 ? '<button class="btn" data-act="hint">First letters</button>' : '') +
        '<button class="btn ghost" data-act="speak">Play cue</button>' +
        '<span class="spacer"></span>' +
        (last ? '' : '<button class="btn ghost" data-act="prev">Back</button>') +
        '<button class="btn ghost" data-act="next">Skip</button>'
      );
    }
    return (
      '<button class="btn primary" data-act="got">Got it</button>' +
      '<button class="btn" data-act="miss">Missed</button>' +
      '<button class="btn ghost" data-act="speak-mine">Hear my line</button>' +
      '<span class="spacer"></span>' +
      (last ? '' : '<button class="btn ghost" data-act="prev">Back</button>') +
      '<button class="btn ghost" data-act="next">Skip</button>'
    );
  }

  function typeControlsHTML() {
    if (!P.checked) {
      return (
        '<button class="btn primary" data-act="check">Check' + (P.typed.trim() ? '' : ' (type first)') + '</button>' +
        '<button class="btn ghost" data-act="reveal">Show the line</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn ghost" data-act="next">Skip</button>'
      );
    }
    return (
      '<button class="btn primary" data-act="next">Next line</button>' +
      '<button class="btn" data-act="retry">Try again</button>' +
      '<button class="btn ghost" data-act="speak-mine">Hear it</button>'
    );
  }

  function shortcutLegend() {
    if (S.settings.mode === 'type') {
      return '<kbd>enter</kbd> check · <kbd>esc</kbd> clear · <kbd>→</kbd> next';
    }
    return (
      '<kbd>space</kbd> reveal · <kbd>h</kbd> hint · <kbd>g</kbd> got it · <kbd>m</kbd> missed · ' +
      '<kbd>→</kbd> next · <kbd>←</kbd> back · <kbd>r</kbd> replay cue'
    );
  }

  /* ── type-mode diffing ── */

  function normWords(s) {
    const n = String(s).toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
    return n ? n.split(' ') : [];
  }

  function diffWords(target, typed) {
    const a = target, b = typed;
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const out = [];
    let i = 0, j = 0, same = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { out.push({ t: 'ok', w: a[i] }); same++; i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: 'miss', w: a[i] }); i++; }
      else { out.push({ t: 'extra', w: b[j] }); j++; }
    }
    while (i < n) out.push({ t: 'miss', w: a[i++] });
    while (j < m) out.push({ t: 'extra', w: b[j++] });
    return { ops: out, score: n ? same / n : 0 };
  }

  function diffHTML(ops) {
    return ops
      .map((o) => '<span class="w ' + o.t + '">' + esc(o.w) + '</span>')
      .join(' ');
  }

  function checkAnswer() {
    const line = lineById(P.queue[P.idx]);
    const typed = (P.typed || '').trim();
    if (!typed) { flash('Type your line first, or press Space to reveal it.'); return; }
    const res = diffWords(normWords(line.text), normWords(typed));
    P.diff = res.ops;
    P.score = res.score;
    P.checked = true;
    mark(line.id, res.score >= 0.85);
    announce(line.text);
    renderPractice();
  }

  /* ── marking & navigation ── */

  function mark(id, ok) {
    const p = S.progress[id] || (S.progress[id] = { seen: 0, known: 0, miss: 0, streak: 0, best: 0 });
    p.seen++;
    if (ok) { p.known++; p.streak = (p.streak || 0) + 1; P.session.ok++; }
    else { p.miss++; p.streak = 0; P.session.miss++; }
    p.last = now();
    save();
  }

  function advance(skip) {
    stopSpeech();
    if (P.idx >= P.queue.length - 1) {
      P.finished = true;
      P.reveal = 0;
      P.typed = '';
      P.checked = false;
      renderPractice();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    P.idx++;
    P.reveal = 0;
    P.typed = '';
    P.checked = false;
    P.diff = null;
    renderPractice();
    if (!skip) autoSpeakCue();
  }

  function goBack() {
    stopSpeech();
    if (P.idx === 0) return;
    P.idx--;
    P.reveal = 0;
    P.typed = '';
    P.checked = false;
    P.diff = null;
    P.finished = false;
    renderPractice();
  }

  function autoSpeakCue() {
    if (!S.settings.autoSpeak) return;
    const line = lineById(P.queue[P.idx]);
    if (!line) return;
    const cues = cueLinesFor(line);
    if (!cues.length) return;
    stopSpeech();
    setTimeout(() => cues.forEach((l) => speak(l.text, l.speaker)), 90);
  }

  function speakCue() {
    const line = lineById(P.queue[P.idx]);
    if (!line) return;
    const cues = cueLinesFor(line);
    stopSpeech();
    setTimeout(() => {
      if (!cues.length) speak(line.text, line.speaker);
      else cues.forEach((l) => speak(l.text, l.speaker));
    }, 60);
  }

  /* ── finished screen ── */

  function renderFinished(stage, controls, keys) {
    const { ok, miss } = P.session;
    const total = ok + miss;
    const pct = total ? Math.round((ok / total) * 100) : 0;
    const trouble = myLines().filter((l) => isTrouble(l.id)).length;

    stage.innerHTML =
      '<div class="done">' +
      '<h2>Scene complete</h2>' +
      '<p class="lede">' +
      (total
        ? 'You worked through ' + total + ' of your lines. ' + (pct >= 80 ? 'That is a strong run.' : 'Run it again while it is fresh.')
        : 'You skipped through without marking any lines.') +
      '</p>' +
      '<div class="done-nums">' +
      '<div><b>' + ok + '</b><span>got it</span></div>' +
      '<div><b>' + miss + '</b><span>missed</span></div>' +
      '<div><b>' + trouble + '</b><span>to drill</span></div>' +
      '</div>' +
      '<div class="row">' +
      '<button class="btn primary" data-act="restart">Run it again</button>' +
      (trouble ? '<button class="btn" data-act="drill">Drill trouble lines</button>' : '') +
      '<button class="btn ghost" data-act="stats">See progress</button>' +
      '</div>' +
      '</div>';
    controls.innerHTML = '';
    keys.textContent = '';
  }

  /* ───────────────────────────── stats ───────────────────────────── */

  function statsFor(lines) {
    let seen = 0, known = 0, mastered = 0, missed = 0;
    lines.forEach((l) => {
      const p = S.progress[l.id];
      if (!p) return;
      seen += p.seen || 0;
      known += p.known || 0;
      if ((p.streak || 0) >= 2) mastered++;
      missed += p.miss || 0;
    });
    return { seen, known, mastered, missed };
  }

  function renderStats() {
    const mine = myLines();
    const st = statsFor(mine);
    const pct = mine.length ? Math.round((st.mastered / mine.length) * 100) : 0;
    const acc = st.seen ? Math.round((st.known / st.seen) * 100) : 0;

    $('#statsSub').textContent = S.title
      ? S.title + ' · ' + S.character + ' · ' + mine.length + ' lines'
      : S.character + ' · ' + mine.length + ' lines';

    $('#statGrid').innerHTML =
      '<div class="stat accent"><b>' + pct + '%</b><span>learnt by heart</span></div>' +
      '<div class="stat"><b>' + st.mastered + '/' + mine.length + '</b><span>lines solid</span></div>' +
      '<div class="stat"><b>' + (st.seen ? acc + '%' : '—') + '</b><span>accuracy</span></div>' +
      '<div class="stat"><b>' + st.seen + '</b><span>attempts</span></div>';

    // by scene
    const byScene = new Map();
    mine.forEach((l) => {
      const s = byScene.get(l.scene) || { total: 0, done: 0 };
      s.total++;
      const p = S.progress[l.id];
      if (p && (p.streak || 0) >= 2) s.done++;
      byScene.set(l.scene, s);
    });
    $('#sceneBars').innerHTML = Array.from(byScene.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([idx, s]) => {
        const label = (S.scenes[idx] && S.scenes[idx].label) || 'Scene ' + (idx + 1);
        const w = s.total ? (s.done / s.total) * 100 : 0;
        return (
          '<div class="scene-row">' +
          '<span class="name">' + esc(label) + '</span>' +
          '<span class="num">' + s.done + ' / ' + s.total + '</span>' +
          '<span class="track"><i class="' + (s.done ? '' : 'none') + '" style="width:' + w + '%"></i></span>' +
          '</div>'
        );
      })
      .join('') || '<p class="empty">No scenes yet.</p>';

    // trouble lines
    const trouble = mine.filter((l) => isTrouble(l.id))
      .sort((a, b) => (S.progress[b.id].miss || 0) - (S.progress[a.id].miss || 0));

    $('#troubleList').innerHTML = trouble.length
      ? trouble
          .map((l) => {
            const p = S.progress[l.id];
            return (
              '<div class="trouble-item" data-jump="' + esc(l.id) + '">' +
              '<div>' +
              '<div class="say">' + fmtSay(l.text) + '</div>' +
              '<div class="meta">' + esc((S.scenes[l.scene] && S.scenes[l.scene].label) || '') + '</div>' +
              '</div>' +
              '<div class="misses">' + p.miss + ' miss' + (p.miss === 1 ? '' : 'es') + '</div>' +
              '</div>'
            );
          })
          .join('')
      : '<p class="empty">Nothing to drill — your lines are holding up.</p>';
  }

  /* ───────────────────────────── ui wiring ───────────────────────────── */

  let flashTimer = null;
  function flash(msg) {
    const keys = $('#keys');
    if (!keys) return;
    const old = keys.innerHTML;
    keys.innerHTML = '<span style="color:var(--accent)">' + esc(msg) + '</span>';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { if (keys.innerHTML.indexOf(msg) > -1) keys.innerHTML = old; }, 2600);
  }

  function announce(text) {
    const live = $('#live');
    if (live) live.textContent = text;
  }

  function openVoiceDialog() {
    $('#rateInput').value = S.settings.rate;
    $('#rateOut').textContent = Number(S.settings.rate).toFixed(1) + '×';
    $('#autoSpeak').checked = !!S.settings.autoSpeak;
    $('#speakDirs').checked = !!S.settings.speakDirections;
    renderAllVoices();
    const dlg = $('#voiceDlg');
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }

  function setCharacter(name) {
    S.character = name;
    save();
    renderCast();
    renderTopbar();
  }

  function jumpToLine(id) {
    const line = lineById(id);
    if (!line) return;
    S.settings.scene = String(line.scene);
    S.settings.troubleOnly = false;
    save();
    show('practice');
    buildQueue(true);
    renderSceneOptions();
    P.idx = Math.max(0, P.queue.indexOf(id));
    P.finished = false;
    renderPractice();
    autoSpeakCue();
  }

  function wire() {
    /* top bar */
    $('#brandBtn').addEventListener('click', () => {
      if (S.lines.length) show('practice');
      else show('import');
    });

    $('#topbarNav').addEventListener('click', (e) => {
      const b = e.target.closest('[data-nav]');
      if (b) show(b.dataset.nav);
    });

    /* import */
    $('#btnParse').addEventListener('click', handleParse);
    $('#btnSample').addEventListener('click', () => {
      $('#scriptInput').value = SAMPLE;
      if (!$('#titleInput').value) $('#titleInput').value = 'The Audition (sample)';
      $('#scriptInput').focus();
    });
    $('#btnClear').addEventListener('click', () => {
      if (!confirm('Start over with a new script? Your current script and progress will be cleared.')) return;
      S = blankState();
      save();
      prefillImport();
      $('#titleInput').value = '';
      show('import');
    });
    $('#scriptInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleParse();
    });

    /* cast */
    $('#charChips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-char]');
      if (b) setCharacter(b.dataset.char);
    });
    $('#btnStart').addEventListener('click', () => {
      if (!S.character) { flash('Pick your character first.'); return; }
      S.settings.scene = 'all';
      S.settings.troubleOnly = false;
      save();
      show('practice');
      autoSpeakCue();
    });
    $('#btnBack').addEventListener('click', () => {
      prefillImport();
      show('import');
    });

    /* script file loading */
    const fileInput = $('#fileInput');
    const dropZone = $('#dropZone');
    const loadFile = (file) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        $('#scriptInput').value = String(reader.result || '');
        const title = $('#titleInput');
        if (!title.value.trim()) {
          title.value = file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
        }
        $('#importErr').textContent = '';
      };
      reader.readAsText(file);
    };
    if (dropZone && fileInput) {
      dropZone.addEventListener('click', () => fileInput.click());
      dropZone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
      });
      fileInput.addEventListener('change', () => { loadFile(fileInput.files[0]); fileInput.value = ''; });
      ['dragenter', 'dragover'].forEach((ev) =>
        dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('over'); })
      );
      ['dragleave', 'dragend', 'drop'].forEach((ev) =>
        dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove('over'); })
      );
      dropZone.addEventListener('drop', (e) => {
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) loadFile(f);
      });
    }

    /* practice toolbar */
    $('#modeSeg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mode]');
      if (!b) return;
      S.settings.mode = b.dataset.mode;
      save();
      P.checked = false;
      P.diff = null;
      P.typed = '';
      renderPractice();
    });
    $('#sceneSel').addEventListener('change', (e) => {
      S.settings.scene = e.target.value;
      save();
      buildQueue(true);
      renderPractice();
      autoSpeakCue();
    });
    $('#troubleOnly').addEventListener('change', (e) => {
      S.settings.troubleOnly = e.target.checked;
      save();
      buildQueue(true);
      renderPractice();
      autoSpeakCue();
    });
    $('#fullScene').addEventListener('change', (e) => {
      S.settings.fullScene = e.target.checked;
      save();
      renderPractice();
    });
    $('#btnVoices').addEventListener('click', openVoiceDialog);

    /* stage + controls (delegated) */
    $('#stage').addEventListener('click', (e) => {
      const hit = e.target.closest('[data-act]');
      if (hit) handleAction(hit.dataset.act);
    });
    $('#stage').addEventListener('input', (e) => {
      if (e.target.id === 'answerBox') P.typed = e.target.value;
    });
    $('#stage').addEventListener('keydown', (e) => {
      if (e.target.id !== 'answerBox') return;
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); P.typed = e.target.value; checkAnswer(); }
      if (e.key === 'Escape') { e.target.value = ''; P.typed = ''; e.target.blur(); }
    });

    $('#controls').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b) handleAction(b.dataset.act);
    });

    /* voices dialog */
    $('#rateInput').addEventListener('input', (e) => {
      S.settings.rate = parseFloat(e.target.value);
      $('#rateOut').textContent = S.settings.rate.toFixed(1) + '×';
      save();
    });
    $('#autoSpeak').addEventListener('change', (e) => {
      S.settings.autoSpeak = e.target.checked;
      save();
    });
    $('#speakDirs').addEventListener('change', (e) => {
      S.settings.speakDirections = e.target.checked;
      save();
    });
    document.addEventListener('change', (e) => {
      const sel = e.target.closest('[data-voice-for]');
      if (!sel) return;
      S.settings.voiceMap[sel.dataset.voiceFor] = sel.value;
      save();
    });
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-test-voice]');
      if (!t) return;
      stopSpeech();
      setTimeout(() => speak('This is what ' + t.dataset.testVoice + ' sounds like.', t.dataset.testVoice), 60);
    });

    /* stats */
    $('#troubleList').addEventListener('click', (e) => {
      const item = e.target.closest('[data-jump]');
      if (item) jumpToLine(item.dataset.jump);
    });
    $('#btnResetProgress').addEventListener('click', () => {
      if (!confirm('Clear all practice progress? Your script stays.')) return;
      S.progress = {};
      save();
      renderStats();
      if (currentView === 'practice') renderPractice();
    });

    /* keyboard */
    document.addEventListener('keydown', onKey);

    /* speech voices arrive late on some browsers */
    if (speechOK) {
      refreshVoices();
      speechSynthesis.addEventListener('voiceschanged', refreshVoices);
      setTimeout(refreshVoices, 600);
    }

    window.addEventListener('beforeunload', stopSpeech);
  }

  function handleAction(act) {
    switch (act) {
      case 'reveal':
        stopSpeech();
        P.reveal = P.reveal === 0 ? 2 : P.reveal === 1 ? 2 : 0;
        renderPractice();
        break;
      case 'hint':
        P.reveal = 1;
        renderPractice();
        break;
      case 'speak':
        speakCue();
        break;
      case 'speak-mine': {
        const line = lineById(P.queue[P.idx]);
        if (line) { stopSpeech(); setTimeout(() => speak(line.text, line.speaker), 60); }
        break;
      }
      case 'got':
        mark(P.queue[P.idx], true);
        advance(false);
        break;
      case 'miss':
        mark(P.queue[P.idx], false);
        advance(false);
        break;
      case 'next':
        advance(true);
        break;
      case 'prev':
        goBack();
        break;
      case 'check':
        checkAnswer();
        break;
      case 'retry':
        P.checked = false;
        P.diff = null;
        P.typed = '';
        renderPractice();
        break;
      case 'restart':
        buildQueue(true);
        renderPractice();
        autoSpeakCue();
        break;
      case 'drill':
        S.settings.troubleOnly = true;
        save();
        buildQueue(true);
        renderPractice();
        autoSpeakCue();
        break;
      case 'stats':
        show('stats');
        break;
      case 'clear-trouble':
        S.settings.troubleOnly = false;
        $('#troubleOnly').checked = false;
        save();
        buildQueue(true);
        renderPractice();
        break;
      case 'pick-character':
        show('cast');
        break;
    }
  }

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    const typingInField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (typingInField) return;
    if (currentView !== 'practice') return;
    if (document.querySelector('dialog[open]')) return;
    if (P.finished || !P.queue.length) return;

    const key = e.key;
    if (key === ' ' || key === 'Spacebar') {
      e.preventDefault();
      if (S.settings.mode === 'type') {
        if (P.checked) handleAction('next');
        else return;
      }
      handleAction(P.reveal === 0 ? 'reveal' : 'reveal');
      return;
    }
    if (key === 'ArrowRight') { e.preventDefault(); handleAction('next'); return; }
    if (key === 'ArrowLeft') { e.preventDefault(); handleAction('prev'); return; }
    if (S.settings.mode !== 'rehearse') return;

    if (key === 'g' || key === 'G') { if (P.reveal === 2) handleAction('got'); else flash('Reveal the line first (space), then mark it.'); return; }
    if (key === 'm' || key === 'M') { if (P.reveal === 2) handleAction('miss'); else flash('Reveal the line first (space), then mark it.'); return; }
    if (key === 'h' || key === 'H') { handleAction('hint'); return; }
    if (key === 'r' || key === 'R') { handleAction('speak'); return; }
  }

  /* ───────────────────────────── boot ───────────────────────────── */

  function init() {
    wire();
    const had = load();

    if (had && S.lines.length && S.character) {
      show('practice');
      autoSpeakCue();
      return;
    }
    if (had && S.lines.length) {
      show('cast');
      return;
    }

    prefillImport();
    show('import');
    loadDefaultScript();
  }

  /**
   * First visit on a device: pull the script configured in default-script.json
   * so the URL opens straight into the part. Silently does nothing when the
   * file is missing (e.g. opened straight from disk with file://).
   */
  async function loadDefaultScript() {
    if (typeof fetch !== 'function') return false;
    try {
      const res = await fetch('default-script.json', { cache: 'no-cache' });
      if (!res.ok) return false;
      const cfg = await res.json();
      if (!cfg || !cfg.path) return false;

      const file = await fetch(cfg.path, { cache: 'no-cache' });
      if (!file.ok) return false;
      const raw = await file.text();

      if (S.lines.length || ($('#scriptInput') && $('#scriptInput').value.trim())) return false;

      const parsed = parseScript(raw);
      if (!parsed.lines.length) return false;

      S.raw = raw;
      S.title = cfg.title || '';
      S.lines = parsed.lines;
      S.scenes = parsed.scenes;
      S.actors = parsed.actors;

      const chars = charactersOf(parsed.lines);
      S.character = chars.some((c) => c.name === cfg.character)
        ? cfg.character
        : chars.length
        ? chars[0].name
        : '';

      ensureVoices();
      save();

      if (S.character) {
        show('practice');
        autoSpeakCue();
      } else {
        show('cast');
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  init();
})();
