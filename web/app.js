const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const LS_PROG = 'ticketops.progress.v1';
const LS_DRAFT = 'ticketops.draft.v1.';
const LS_HINT = 'ticketops.hint.v1.'; // 每题已解锁到第几级

const S = {
  data: null,
  scen: {},
  mem: {},
  hints: {},
  prog: {},
  bridge: false,
  fake: false,
  chapter: null,
  cur: null,
  ex: null,
  sc: null,
  holes: {},
  sel: null,
  running: false,
};

/* ---------------- 工具 ---------------- */
// 文本节点用的转义：不碰引号，否则代码里的字符串永远匹配不到高亮规则
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// 属性值用这个：必须转义 " —— 芯片值会写进 data-v="..."，含引号时属性会被提前截断
const esc = (s) => escText(s).replace(/"/g, '&quot;');

// 顺序有讲究：注释和字符串要排在关键字前面，否则 "if" 这种字符串内容会被当成关键字
const RE_HL =
  /(\/\/.*$)|("(?:\\.|[^"\\])*")|(\b(?:struct|impl|fn|let|mut|pub|use|mod|if|else|match|as|return|loop|while|for|in|trait|enum|where|unsafe|const|static|ref|move|dyn|async|await|Self)\b)|(\b(?:u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|isize|f32|f64|bool|char|String|str|Vec|Option|Result|self|true|false)\b)|(\b\d+\b)/gm;

function hl(text) {
  return escText(text).replace(RE_HL, (m, cm, str, kw, ty, num) => {
    if (cm) return `<i class="c">${cm}</i>`;
    if (str) return `<i class="s">${str}</i>`;
    if (kw) return `<i class="k">${kw}</i>`;
    if (ty) return `<i class="t">${ty}</i>`;
    return `<i class="d">${num}</i>`;
  });
}

function inlineMd(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}

// lib.rs 顶部注释里空行 = 段落，单换行 = 段内折行
function paragraphs(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${inlineMd(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('on'), 2400);
}

function lsLoad(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function lsSave(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

/* ---------------- 启动 ---------------- */
// 启动日志按真实数据生成，不写死数字。
// 行数刻意压到 3 行：这是落地页，日志只是交代状态，不该压过介绍和入口
function bootLines() {
  const custom = Object.keys(S.scen || {}).length;
  const mem = Object.keys(S.mem || {}).length;
  return [
    [`> 载入 ${S.data.total} 张工单 · ${S.data.chapters.length} 个区域`, 'ok'],
    [`> 定制玩法 ${custom} 张 · 内存透视 ${mem} 张`, 'ok'],
    ['> 连接本地桥 127.0.0.1:7878', S.bridge ? (S.fake ? 'FAKE' : 'online') : 'DEMO'],
  ];
}

async function bootLog() {
  const box = $('#bootlog');
  box.innerHTML = '';
  for (const [text, tag] of bootLines()) {
    const d = document.createElement('div');
    d.className = 'bl';
    const t = tag === 'ok' ? 'b' : 's';
    d.innerHTML = `<span>${esc(text)}</span><i></i><${t}>${esc(tag)}</${t}>`;
    box.appendChild(d);
    await new Promise((r) => setTimeout(r, 130));
  }
  const st = $('#boot-state');
  st.textContent = S.bridge ? (S.fake ? 'FAKE' : 'ONLINE') : 'DEMO';
  st.className = S.bridge ? (S.fake ? 'fake' : '') : 'demo';
}

function fillAboutStats() {
  const set = (sel, v) => { const el = $(sel); if (el) el.textContent = v; };
  set('#bn-total', S.data.total);
  set('#bn-eb-total', S.data.total);
  set('#bn-ch', S.data.chapters.length);
  set('#bn-custom', Object.keys(S.scen || {}).length);
  set('#bn-mem', Object.keys(S.mem || {}).length);
  const tags = $('#bn-tags');
  if (tags) {
    tags.innerHTML = S.data.chapters
      .map((c) => `<span>${esc(c.title.replace(/^A /, ''))}<b>${c.exercises.length}</b></span>`)
      .join('');
  }
  const done = Object.keys(S.prog || {}).filter((id) => S.prog[id] && S.data.exercises[id]).length;
  set('#bp-txt', `${done} / ${S.data.total}`);
  const fill = $('#bp-fill');
  if (fill) fill.style.width = (done / S.data.total) * 100 + '%';
  $('#boot-prog').hidden = false;
}

async function main() {
  S.prog = lsLoad(LS_PROG, {});

  const health = await fetch('api/health').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  // 只有 ok === true 才算连上了本地桥：静态托管下 api/health 返回 {ok:false}，不能当成桥
  S.bridge = !!(health && health.ok === true);
  S.fake = !!(health && health.fake);

  try {
    S.data = await (await fetch('data/exercises.json')).json();
  } catch {
    $('#bootlog').innerHTML = '<b style="color:#fb7185">✗ 读不到 data/exercises.json</b><br><br>请通过本地桥打开：<br>node bridge/server.mjs<br>然后访问 http://127.0.0.1:7878';
    return;
  }
  S.scen = await (await fetch('data/scenarios.json')).json().catch(() => ({}));
  S.scen = S.scen.items || S.scen;
  S.mem = (await (await fetch('data/memory.json')).json().catch(() => ({}))).items || {};
  S.hints = (await (await fetch('data/hints.json')).json().catch(() => ({}))).items || {};

  fillAboutStats();
  await bootLog();

  $('#st-total').textContent = S.data.total;
  if (S.bridge) {
    $('#st-bridge').textContent = S.fake ? 'FAKE' : 'online';
    $('#foot-bridge').textContent = S.fake ? '当前为 FAKE 模式（不真的编译）' : '真实编译：cargo test';
  } else {
    // 在线演示版：没有本地桥，用「空位是否填对」代替真实编译
    $('#health-dot').classList.add('demo');
    $('#st-bridge').textContent = 'demo';
    $('#st-bridge').style.color = 'var(--accent-2)';
    $('#foot-bridge').textContent = '在线演示版 · 拼装题可玩可判定，自由编辑题需本地 cargo';
    const env = $('#boot-foot-env');
    if (env) env.textContent = '在线演示版：11 道拼装题可玩可判定 · 真实 cargo 编译需在本机运行';
  }
  $('#bootgo').hidden = false;
  initPanel();
}

let entered = false;
function enter() {
  const b = $('#boot');
  b.style.transition = 'opacity .4s';
  b.style.opacity = '0';
  setTimeout(() => {
    b.hidden = true;
    $('#app').hidden = false;
    $('#app').classList.add('rise');
    if (!entered) {
      entered = true;
      // 带 hash 进来（刷新或分享链接）就落回原处，否则从星图起步
      if (location.hash && location.hash !== '#' && location.hash !== '#/') restoreByHash();
      else goMap(true);
      updateNavBtns();
    }
  }, 380);
}

// 从工作台回看首页（介绍 / 题库 / 来源）
function openAbout() {
  const b = $('#boot');
  fillAboutStats(); // 进度可能变了，重算一次
  b.scrollTop = 0;
  b.style.opacity = '0';
  b.hidden = false;
  $('#bootgo').textContent = '返回系统（ENTER）';
  requestAnimationFrame(() => {
    b.style.transition = 'opacity .28s';
    b.style.opacity = '1';
  });
}

/* ---------------- 星图 ---------------- */
function solvedCount(ids) {
  return ids.filter((id) => S.prog[id]).length;
}

function renderSectors() {
  $('#st-fixed').textContent = Object.keys(S.prog).length;
  $('#st-cur').textContent = '星图';
  // 刚结单的区域闪两下，只消费一次
  const fresh = sessionStorage.getItem('ticketops.fresh');
  if (fresh) sessionStorage.removeItem('ticketops.fresh');
  $('#sectors').innerHTML = S.data.chapters
    .map((ch) => {
      const done = solvedCount(ch.exercises);
      const total = ch.exercises.length;
      const left = total - done;
      const pct = Math.round((done / total) * 100);
      return `<div class="sector ${done === total ? 'done' : ''} ${fresh === ch.id ? 'fresh' : ''}" data-ch="${ch.id}">
        <div class="n">SECTOR ${ch.id.slice(0, 2)}</div>
        <div class="t">${esc(ch.title)}</div>
        <div class="p">
          <span class="pc">已完成 <b class="${done ? 'on' : ''}">${done}</b></span>
          <span class="dot">·</span>
          <span class="pt">${left ? `待完成 <b>${left}</b>` : '全部完成'}</span>
        </div>
        <div class="bar"><i style="width:${pct}%"></i></div>
      </div>`;
    })
    .join('');
  $$('.sector').forEach((el) => el.addEventListener('click', () => openChapter(el.dataset.ch)));
}

/* ---------------- 浏览历史（URL hash 是唯一状态源） ---------------- */
const NAV = { max: 0 };

function navIndex() {
  return (history.state && history.state.i) || 0;
}

// 每次导航压一条记录，hash 顺便让刷新/分享都能落回原处
function pushNav(hash) {
  const i = navIndex() + 1;
  history.pushState({ i }, '', hash);
  NAV.max = i; // 新分支：前进栈被丢弃
  updateNavBtns();
}

function updateNavBtns() {
  const i = navIndex();
  const back = $('#nav-back');
  const fwd = $('#nav-fwd');
  if (!back || !fwd) return;
  back.disabled = i <= 0;
  fwd.disabled = i >= NAV.max;
}

function navHashOf(screen, id) {
  if (screen === 'chapter') return '#/chapter/' + id;
  if (screen === 'bench') return '#/ex/' + id;
  return '#/';
}

// popstate / 刷新 / 直接打开带 hash 的链接都走这里
function restoreByHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  if (!raw) {
    renderSectors();
    showScreen('map');
    return;
  }
  const parts = raw.split('/');
  const kind = parts.shift();
  const id = parts.join('/');
  if (kind === 'chapter' && id && S.data.chapters.some((c) => c.id === id)) {
    openChapter(id, true);
    return;
  }
  if (kind === 'ex' && id && S.data.exercises[id]) {
    openEx(id, true);
    return;
  }
  renderSectors();
  showScreen('map');
}

function goMap(fromNav) {
  renderSectors();
  showScreen('map');
  if (!fromNav) pushNav('#/');
}

function goBack() {
  if (navIndex() > 0) history.back();
  else if (!$('#bench-screen').hidden) openChapter(S.chapter);
  else if (!$('#chapter-screen').hidden) goMap();
}

function goForward() {
  if (navIndex() < NAV.max) history.forward();
}

function openChapter(id, fromNav) {
  S.chapter = id;
  const ch = S.data.chapters.find((c) => c.id === id);
  $('#ch-title').textContent = `${ch.id.slice(0, 2)} · ${ch.title}`;
  $('#st-cur').textContent = '区域 ' + ch.id.slice(0, 2);
  $('#rail').innerHTML = ch.exercises
    .map((eid) => {
      const ex = S.data.exercises[eid];
      const sc = S.scen[eid];
      const mode = sc ? sc.label : '自由编辑';
      const solved = !!S.prog[eid];
      return `<div class="tk ${solved ? 'solved' : ''}" data-ex="${eid}">
        <div class="no">#${ex.no}</div>
        <div><div class="ti">${esc(ex.title)}</div>
        <div class="sub">${mode} · ${ex.testCount} 项验收</div></div>
      </div>`;
    })
    .join('');
  $$('.tk').forEach((el) => el.addEventListener('click', () => openEx(el.dataset.ex)));
  showScreen('chapter');
  if (!fromNav) pushNav(navHashOf('chapter', id));
}

function showScreen(name) {
  $('#map-screen').hidden = name !== 'map';
  $('#chapter-screen').hidden = name !== 'chapter';
  $('#bench-screen').hidden = name !== 'bench';
  if (name === 'bench') fitBench();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 工作台铺满视口：高度 = 视口高 - 工作台在文档里的绝对顶部（+scrollY 不受滚动动画影响）
function fitBench() {
  const screen = $('#bench-screen');
  const bench = $('.bench');
  if (screen.hidden || window.innerWidth <= 920) {
    bench.style.height = '';
    return;
  }
  const top = bench.getBoundingClientRect().top + window.scrollY;
  const h = Math.max(420, Math.round(window.innerHeight - top - 24));
  bench.style.height = h + 'px';
}
let fitTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(() => {
    fitBench();
    drawXrayLinks();
  }, 80);
});

/* ---------------- 工作台 ---------------- */
function openEx(id, fromNav) {
  const ex = S.data.exercises[id];
  if (!ex) return;
  S.cur = id;
  S.ex = ex;
  S.sc = S.scen[id] || {
    mode: 'editor',
    label: '自由编辑',
    template: ex.starter.replace(/\r\n/g, '\n'),
    slots: [],
  };
  S.holes = {};
  S.sel = null;
  S.running = false;

  $('#st-cur').textContent = '#' + ex.no;
  $('#ex-no').textContent = `TICKET #${ex.no} · ${ex.chapterTitle}`;
  $('#ex-title').textContent = ex.title;
  $('#ex-task').innerHTML = ex.task
    ? paragraphs(ex.task)
    : '<p style="color:var(--dim)">这道题没有文字说明，直接看验收清单。</p>';

  renderAccept();
  renderHints();
  renderMode();
  restoreDraft();
  $('#banner').hidden = true;
  $('#next').hidden = true;
  resetFx();

  // 内存透视只对这 4 题开放，切到别处时把 tab 收起来
  const hasMem = !!(S.mem && S.mem[id]);
  $('#pb-tab-xray').hidden = !hasMem;
  if (hasMem) {
    XR.id = null;
    renderXray();
  } else if (P.tab === 'xray') {
    switchTab('term');
  }
  term([{ t: `$ wr open ${id}`, c: 'cy' }, { t: `  ${ex.testCount} 项验收条件已载入`, c: 'dm' }]);
  setRunMsg('准备就绪');
  showScreen('bench');
  if (!fromNav) pushNav(navHashOf('bench', id));
}

function renderAccept() {
  const tests = S.ex.tests || [];
  if (!tests.length) {
    $('#accept').innerHTML = `<div class="ac" data-t="__compile"><span class="bx"></span>
      <span class="bd"><span class="nm">compile</span><div class="dt">编译通过即过关（这道题没有测试）</div></span></div>`;
    return;
  }
  $('#accept').innerHTML = tests
    .map(
      (t, i) => `<div class="ac" data-t="${esc(t.name)}"><span class="bx"></span>
      <span class="bd"><span class="nm">${esc(t.name)}</span>
      <div class="dt">${t.kind === 'panic' ? '应 panic：' + esc(t.detail || '任意 panic 都算通过') : esc(t.detail || '—')}</div></span></div>`
    )
    .join('');
}

/* ---------------- 分级提示 ---------------- */
const HINT_LV = ['只说方向', '点出 API', '给个骨架'];

function hintLevel(id) {
  return Math.min(3, Number(lsLoad(LS_HINT + id, 0)) || 0);
}

function renderHints() {
  const box = $('#hint');
  const h = S.hints[S.cur];
  if (!h) {
    box.hidden = true;
    $('#hint-list').innerHTML = '';
    const b = $('#hint-btn');
    b.textContent = '卡住了？先看第 1 级提示（只说方向）';
    b.disabled = false;
    b.classList.remove('nudge');
    return;
  }
  box.hidden = false;

  const used = hintLevel(S.cur);
  $('#hint-list').innerHTML = ['h1', 'h2', 'h3']
    .slice(0, used)
    .map((k, i) => `<div class="hint-item"><div class="lv">L${i + 1} · ${HINT_LV[i]}</div><p>${inlineMd(h[k])}</p></div>`)
    .join('');

  const btn = $('#hint-btn');
  btn.classList.remove('nudge');
  btn.disabled = used >= 3;
  if (used >= 3) btn.textContent = '三级提示都用完了 · 试着自己改';
  else if (used === 0) btn.textContent = '卡住了？先看第 1 级提示（只说方向）';
  else btn.textContent = `还不够？看第 ${used + 1} 级提示${used === 2 ? '（会给出代码骨架）' : ''}`;
}

function unlockHint() {
  if (!S.cur) return;
  const lv = Math.min(3, hintLevel(S.cur) + 1);
  lsSave(LS_HINT + S.cur, lv);
  renderHints();
  if (lv >= 3) toast('提示用完 · 这题记作「看骨架完成」');
}

function slotLabel(key) {
  const s = (S.sc.slots || []).find((x) => x.key === key);
  return s ? s.label : key;
}

function renderMode() {
  const isEditor = S.sc.mode === 'editor';
  $('#code-wrap').hidden = isEditor;
  $('#editor-wrap').hidden = !isEditor;
  $('#mode-lbl').textContent = 'MODE · ' + S.sc.label;
  const modeHint = isEditor
    ? 'Tab 缩进 · 草稿自动保存'
    : S.sc.mode === 'toggle'
    ? '点代码里的开关，切换可见性'
    : '点空位 → 点芯片；也可以直接把芯片拖进去';
  $('#mode-hint').textContent = modeHint + (S.mem && S.mem[S.cur] ? ' · 底部「内存」看栈与堆' : '') + (S.bridge ? '' : ' · 在线演示版');

  if (isEditor) {
    renderEditor();
  } else {
    renderCode();
    renderChips();
  }
}

function renderCode() {
  const parts = S.sc.template.split(/(\{\{\w+\}\})/);
  $('#code').innerHTML = parts
    .map((part) => {
      const m = part.match(/^\{\{(\w+)\}\}$/);
      if (!m) return hl(part);
      const k = m[1];
      const v = S.holes[k];
      const has = v != null;
      const cls = ['hole', has ? 'filled' : '', S.sel === k ? 'sel' : ''].join(' ').replace(/\s+/g, ' ').trim();
      // 未填时留空，由 CSS 画一条居中的填空虚线（字符占位在等宽字体里会掉到 baseline 下面）
      const shown = has ? esc(v === '' ? 'private' : v) : '';
      return `<button class="${cls}" data-k="${k}" title="${esc(slotLabel(k))}">${shown}</button>`;
    })
    .join('');

  $$('#code .hole').forEach((el) => {
    el.addEventListener('click', () => {
      const k = el.dataset.k;
      if (S.sc.mode === 'toggle' && !S.sel) {
        // 开关模式：点一下直接轮转
        cycleToggle(k);
        return;
      }
      S.sel = k;
      renderCode();
    });
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('over');
      const v = e.dataTransfer.getData('text/plain');
      if (v) {
        S.holes[el.dataset.k] = v;
        S.sel = el.dataset.k;
        renderCode();
        saveDraft();
      }
    });
  });
}

function renderChips() {
  if (S.sc.mode === 'toggle') { $('#chips').innerHTML = ''; return; }
  const pool = [...new Set((S.sc.slots || []).flatMap((s) => s.options))];
  $('#chips').innerHTML = pool
    .map((v) => `<button class="chip" draggable="true" data-v="${esc(v)}">${v === '' ? 'private' : esc(v)}</button>`)
    .join('');
  $$('#chips .chip').forEach((ch) => {
    ch.addEventListener('click', () => applyChip(ch.dataset.v));
    ch.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', ch.dataset.v));
  });
}

function applyChip(v) {
  let k = S.sel;
  if (!k) {
    const empty = (S.sc.slots || []).find((s) => S.holes[s.key] == null);
    k = empty ? empty.key : null;
  }
  if (!k) {
    toast('先点一个空位，再点芯片');
    return;
  }
  S.holes[k] = v;
  S.sel = k;
  renderCode();
  saveDraft();
}

function cycleToggle(k) {
  const slot = (S.sc.slots || []).find((s) => s.key === k);
  if (!slot) return;
  const i = slot.options.indexOf(S.holes[k] ?? '');
  S.holes[k] = slot.options[(i + 1) % slot.options.length];
  renderCode();
  saveDraft();
}

/* ---------------- 编辑器 ---------------- */
function renderEditor() {
  const ta = $('#editor');
  ta.value = S.sc.template;
  syncGutter();
  ta.oninput = () => {
    syncGutter();
    clearTimeout(ta._t);
    ta._t = setTimeout(saveDraft, 400);
  };
  ta.onkeydown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart;
      ta.value = ta.value.slice(0, s) + '    ' + ta.value.slice(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = s + 4;
      syncGutter();
    }
  };
  ta.onscroll = () => {
    $('#gutter').scrollTop = ta.scrollTop;
    syncHlScroll();
  };
  if (!$('#editor-wrap')._bound) {
    $('#editor-wrap')._bound = true;
    $('#editor-wrap').addEventListener('click', (e) => { if (e.target.id === 'gutter') $('#editor').focus(); });
  }
}

// textarea 本身没法上色：文字设成透明，底下一层 <pre> 同步渲染高亮。
// 两层必须字字对齐（字体/字号/行高/padding/tab-size 完全一致），否则光标会飘。
function syncHighlight() {
  const ta = $('#editor');
  const pre = $('#ed-hl');
  if (!pre || !ta) return;
  // 末尾补一个换行：<pre> 会吞掉最后的空行，导致最后一行对不齐
  pre.innerHTML = hl(ta.value) + '\n';
  syncHlScroll();
}

function syncHlScroll() {
  const ta = $('#editor');
  const pre = $('#ed-hl');
  if (!pre || !ta) return;
  pre.scrollTop = ta.scrollTop;
  pre.scrollLeft = ta.scrollLeft;
}

function syncGutter() {
  const n = $('#editor').value.split('\n').length;
  $('#gutter').innerHTML = Array.from({ length: n }, (_, i) => i + 1).join('<br>');
  $('#gutter').scrollTop = $('#editor').scrollTop;
  syncHighlight();
}

/* ---------------- 草稿 ---------------- */
function saveDraft() {
  if (!S.cur) return;
  if (S.sc.mode === 'editor') {
    lsSave(LS_DRAFT + S.cur, { code: $('#editor').value });
  } else {
    lsSave(LS_DRAFT + S.cur, { holes: S.holes });
  }
}

function restoreDraft() {
  const d = lsLoad(LS_DRAFT + S.cur, null);
  if (!d) return;
  if (S.sc.mode === 'editor' && typeof d.code === 'string') {
    $('#editor').value = d.code;
    syncGutter();
  } else if (d.holes) {
    // 丢掉不在选项里的旧值（旧版本截断过含引号的芯片值，避免残稿一直填错）
    S.holes = Object.fromEntries(
      Object.entries(d.holes).filter(([k, v]) => {
        const slot = (S.sc.slots || []).find((s) => s.key === k);
        return slot ? slot.options.includes(v) : false;
      })
    );
    renderCode();
  }
}

/* ---------------- 底部面板（终端 / 问题，可拖高可折叠） ---------------- */
const LS_PANEL = 'ticketops.panel.v1';
const FOLD_H = 34;
const DEFAULT_H = 220;
// 默认高度按视口给：1440×900 ≈ 234，1366×768 ≈ 200
const defaultH = () => Math.round(Math.min(244, Math.max(150, window.innerHeight * 0.26)));
const P = { tab: 'term', h: DEFAULT_H, last: DEFAULT_H, errors: [] };

function setPanelH(h) {
  P.h = Math.round(h);
  $('.bench').style.setProperty('--term-h', P.h + 'px');
  $('#panel-bottom').classList.toggle('folded', P.h <= FOLD_H);
  $('#pb-fold').textContent = P.h <= FOLD_H ? '展开' : '折叠';
}

function savePanel() {
  lsSave(LS_PANEL, { tab: P.tab, h: P.h, last: P.last });
}

function switchTab(name) {
  P.tab = name;
  $$('.pb-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $('#term').hidden = name !== 'term';
  $('#problems').hidden = name !== 'problems';
  $('#xray').hidden = name !== 'xray';
  // 栈 + 堆要同时进画面，200 出头的高度不够；用户已经拖得更高就不动
  if (name === 'xray' && P.h > FOLD_H && P.h < 320) {
    P.last = Math.max(P.last, 320);
    setPanelH(320);
  }
  if (name === 'xray') requestAnimationFrame(drawXrayLinks);
  savePanel();
}

/* ---------------- 内存透视 ---------------- */
const XR = { id: null, idx: 0 };

function renderXray() {
  const box = $('#xray');
  const mem = S.mem && S.mem[S.cur];
  if (!mem) {
    box.innerHTML = '<div class="xr-empty">这一节没有内存透视数据。</div>';
    return;
  }
  if (XR.id !== S.cur) {
    XR.id = S.cur;
    XR.idx = 0;
  }
  XR.idx = Math.max(0, Math.min(XR.idx, mem.steps.length - 1));
  const step = mem.steps[XR.idx];
  const heap = step.heap || [];
  const noHeap = !heap.length;

  box.innerHTML = `
    <div class="xr-head">
      <span class="xr-step">步骤 ${XR.idx + 1} / ${mem.steps.length}</span>
      <span class="xr-label">${esc(step.label)}</span>
      <span class="xr-nav">
        <button id="xr-prev"${XR.idx === 0 ? ' disabled' : ''}>← 上一步</button>
        <button id="xr-next"${XR.idx === mem.steps.length - 1 ? ' disabled' : ''}>下一步 →</button>
      </span>
    </div>
    <div class="xr-body${noHeap ? ' no-heap' : ''}" id="xr-body">
      <svg class="xr-links" id="xr-links"></svg>
      <div class="xr-col">
        <div class="xr-col-t">栈</div>
        ${(step.stack || []).map(varCard).join('')}
      </div>
      ${noHeap ? '' : `<div class="xr-col"><div class="xr-col-t">堆</div>${heap.map(heapCard).join('')}</div>`}
    </div>
    <div class="xr-note">${esc(step.note)}</div>`;

  $('#xr-prev').onclick = () => { if (XR.idx > 0) { XR.idx--; renderXray(); } };
  $('#xr-next').onclick = () => { if (XR.idx < mem.steps.length - 1) { XR.idx++; renderXray(); } };
  requestAnimationFrame(drawXrayLinks);
}

function varCard(v) {
  const fields = (v.fields || [])
    .map((f) => {
      const attr = f.to ? ` data-to="${esc(f.to)}"${f.broken ? ' data-broken="1"' : ''}` : '';
      return `<div class="xr-f"${attr}><span class="k">${esc(f.k)}</span><em>${esc(f.v)}</em></div>`;
    })
    .join('');
  return `<div class="xr-var" data-kind="${esc(v.kind || 'plain')}" data-v="${esc(v.name)}">
    <div class="xr-vh"><b>${esc(v.name)}</b><span>${esc(v.type)} · ${esc(v.size)}</span></div>
    ${fields}
  </div>`;
}

function heapCard(h) {
  return `<div class="xr-heap-item" data-h="${esc(h.id)}">
    <span class="a">${esc(h.addr)}</span><span class="v">${esc(h.value)}</span><span class="b">${esc(h.bytes)}</span>
  </div>`;
}

// 箭头按元素实际位置画，所以窗口缩放、面板拖高、tab 切换后都要重画
function drawXrayLinks() {
  const body = $('#xr-body');
  const svg = $('#xr-links');
  if (!body || !svg || body.offsetParent === null) return;
  const b = body.getBoundingClientRect();
  if (!b.width || !b.height) return;
  const defs =
    '<defs><marker id="xr-a" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
    '<path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>';
  const parts = [];

  $$('.xr-f[data-to]').forEach((el) => {
    const to = el.dataset.to;
    const isStack = to.startsWith('s:');
    const target = isStack
      ? $(`.xr-var[data-v="${CSS.escape(to.slice(2))}"]`)
      : $(`.xr-heap-item[data-h="${CSS.escape(to)}"]`);
    if (!target) return;
    const a = el.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    const x1 = a.right - b.left;
    const y1 = a.top + a.height / 2 - b.top;
    const x2 = t.left - b.left;
    const y2 = t.top + t.height / 2 - b.top;

    if (el.dataset.broken === '1') {
      // 移动之后的旧指针：线只画一半，末端打个叉
      const cut = x1 + Math.min(28, (x2 - x1) * 0.42);
      parts.push(`<path d="M${x1} ${y1}L${cut} ${y1}" fill="none" stroke="rgba(251,113,133,.5)" stroke-width="1.2" stroke-dasharray="4 3"/>`);
      parts.push(`<path d="M${cut - 3.5} ${y1 - 3.5}L${cut + 3.5} ${y1 + 3.5}M${cut + 3.5} ${y1 - 3.5}L${cut - 3.5} ${y1 + 3.5}" fill="none" stroke="rgba(251,113,133,.8)" stroke-width="1.4" stroke-linecap="round"/>`);
      return;
    }

    if (isStack) {
      // 引用指回栈上的另一个变量：走卡片右侧的通道，不横穿卡片
      const lane = x1 + 26;
      const back = t.right - b.left + 4;
      parts.push(
        `<path d="M${x1} ${y1}H${lane}V${y2}H${back}" fill="none" stroke="rgba(34,211,238,.55)" stroke-width="1.3" marker-end="url(#xr-a)"/>`
      );
      parts.push(`<circle cx="${x1}" cy="${y1}" r="2.1" fill="rgba(34,211,238,.85)"/>`);
      return;
    }

    const mx = (x1 + x2) / 2;
    parts.push(
      `<path d="M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" fill="none" stroke="rgba(34,211,238,.5)" stroke-width="1.3" marker-end="url(#xr-a)"/>`
    );
    parts.push(`<circle cx="${x1}" cy="${y1}" r="2.1" fill="rgba(34,211,238,.85)"/>`);
  });

  svg.setAttribute('viewBox', `0 0 ${Math.round(b.width)} ${Math.round(b.height)}`);
  svg.setAttribute('width', Math.round(b.width));
  svg.setAttribute('height', Math.round(b.height));
  svg.innerHTML = defs + parts.join('');
}

function toggleFold() {
  if (P.h > FOLD_H) {
    P.last = P.h;
    setPanelH(FOLD_H);
  } else {
    setPanelH(P.last || defaultH());
  }
  savePanel();
}

function initPanel() {
  const saved = lsLoad(LS_PANEL, null);
  if (saved) {
    P.tab = saved.tab || 'term';
    P.last = saved.last || defaultH();
    setPanelH(saved.h || defaultH());
  } else {
    setPanelH(defaultH());
  }
  // 上次停在「内存」但这次进的题没有透视数据，就退回终端
  if (P.tab === 'xray' && !Object.keys(S.mem || {}).length) P.tab = 'term';
  switchTab(P.tab);

  const panel = $('#panel-bottom');
  const bench = $('.bench');
  let drag = null;

  $('#pb-handle').addEventListener('mousedown', (e) => {
    if (window.innerWidth <= 920) return;
    e.preventDefault();
    drag = { y: e.clientY, h: panel.getBoundingClientRect().height };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  });
  $('#pb-handle').addEventListener('dblclick', toggleFold);
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    // 上边界最多顶到「代码区还剩 260px」的地方，保证编辑器不被压没
    const maxH = Math.max(120, Math.round(bench.getBoundingClientRect().height - 260));
    setPanelH(Math.min(maxH, Math.max(FOLD_H, drag.h - (e.clientY - drag.y))));
  });
  window.addEventListener('mouseup', () => {
    if (!drag) return;
    drag = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (P.h > FOLD_H) P.last = P.h;
    savePanel();
  });

  $$('.pb-tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('#pb-fold').addEventListener('click', toggleFold);
  $('#term-clear').addEventListener('click', () => {
    $('#term').innerHTML = '';
    toast('终端已清空');
  });
}

// E0308 的 label 形如 expected `u16`, found `i32`，拆成左右对撞
function mismatch(e) {
  if (e.code !== 'E0308' || !e.label) return null;
  const m = String(e.label).match(/expected `(.+?)`, found `(.+?)`/);
  return m ? { expected: m[1], found: m[2] } : null;
}

function problemHtml(e, i) {
  const mm = mismatch(e);
  const spans = e.spans || [];
  const kids = e.children || [];
  return `<div class="pb-item ${e.level === 'error' ? 'err' : 'warn'}" data-i="${i}" tabindex="0" role="button">
    <div class="pb-hd"><span class="pb-code">${esc(e.code || e.level)}</span>${e.loc ? `<span class="pb-loc">${esc(e.loc)}</span>` : ''}</div>
    <div class="pb-msg">${esc(e.message)}</div>
    ${
      mm
        ? `<div class="pb-type">
            <span class="pt"><em>期望</em><b>${esc(mm.expected)}</b></span>
            <span class="neq">≠</span>
            <span class="pt"><em>实际</em><b>${esc(mm.found)}</b></span>
          </div>`
        : e.label
          ? `<div class="pb-label">${esc(e.label)}</div>`
          : ''
    }
    ${e.hint ? `<div class="pb-hint">▸ ${esc(e.hint)}</div>` : ''}
    ${
      spans.length
        ? `<ul class="pb-spans">${spans
            .map((s) => `<li data-line="${s.line}"><b>第 ${s.line} 行</b><span>${esc(s.label)}</span></li>`)
            .join('')}</ul>`
        : ''
    }
    ${kids.length ? `<div class="pb-helps">${kids.map((c) => `<div class="pb-help"><span>${esc(c.level)}</span><i>${esc(c.message)}</i></div>`).join('')}</div>` : ''}
  </div>`;
}

// 编译错误逐条列出；带位置的可点击跳到编辑器的对应行
function renderProblems(list) {
  const box = $('#problems');
  const badge = $('#pb-badge');
  const items = (list || []).filter((e) => e.level === 'error' || e.level === 'warning');
  P.errors = items;

  badge.hidden = !items.length;
  badge.textContent = items.length;

  if (!items.length) {
    box.innerHTML = '<div class="pb-empty">没有编译错误。</div>';
    return;
  }

  // 所有 MachineApplicable 建议一次性应用：分开应用会让后一处字节偏移失效
  // 拼装模式的代码是模板生成的，改源码没意义，所以只给自由编辑模式
  const fixes = S.sc && S.sc.mode === 'editor' ? collectFixes(items) : [];
  box.classList.remove('stale'); // 新结果来了，清掉「已应用」的过期标记
  box.innerHTML =
    (fixes.length
      ? `<div class="pb-fixbar"><span>编译器给了 ${fixes.length} 处可直接替换的建议</span>
          <button class="pb-fixall" id="pb-fixall">应用全部</button></div>`
      : '') + items.map(problemHtml).join('');

  $$('#problems .pb-item').forEach((el) => {
    el.addEventListener('click', () => {
      const e = items[Number(el.dataset.i)];
      if (e && e.line) gotoLine(e.line);
    });
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        const e = items[Number(el.dataset.i)];
        if (e && e.line) gotoLine(e.line);
      }
    });
  });
  $$('#problems .pb-spans li').forEach((li) =>
    li.addEventListener('click', (ev) => {
      ev.stopPropagation();
      gotoLine(Number(li.dataset.line));
    })
  );
  const all = $('#pb-fixall');
  if (all) all.addEventListener('click', () => applyAllFixes(fixes, all));
}

function collectFixes(items) {
  const list = items.flatMap((e) => e.fixes || []).sort((a, b) => a.start - b.start);
  const kept = [];
  for (const f of list) {
    if (kept.length && f.start < kept[kept.length - 1].end) continue; // 重叠的丢掉后一个
    kept.push(f);
  }
  return kept;
}

// rustc 的 byte_start/byte_end 是 UTF-8 字节偏移，JS 字符串是 UTF-16，必须按字节拼
function spliceBytes(src, fixes) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const bytes = enc.encode(src);
  const parts = [];
  let cur = bytes.length;
  for (const f of [...fixes].sort((a, b) => b.start - a.start)) {
    if (f.start < 0 || f.end > bytes.length || f.start > f.end) continue;
    parts.unshift(dec.decode(bytes.subarray(f.end, cur)));
    parts.unshift(f.text);
    cur = f.start;
  }
  parts.unshift(dec.decode(bytes.subarray(0, cur)));
  return parts.join('');
}

function applyAllFixes(fixes, btn) {
  if (!S.sc || S.sc.mode !== 'editor') {
    toast('拼装模式改不了源码，按上面的提示自己调芯片');
    return;
  }
  const ta = $('#editor');
  if (S.lastRunSrc != null && ta.value !== S.lastRunSrc) {
    toast('代码已经改过了，先重新运行一次再应用建议');
    return;
  }
  ta.value = spliceBytes(ta.value, fixes);
  S.lastRunSrc = ta.value;
  syncGutter();
  saveDraft();
  if (btn) {
    btn.disabled = true;
    btn.textContent = '已应用';
  }
  // 源码变了，面板里这些位置就不再准确 —— 标记过期，避免用户以为错误还在
  $('#problems').classList.add('stale');
  toast(`已替换 ${fixes.length} 处，再跑一次验证`);
  setRunMsg('已按编译器建议修改 · 运行测试验证', 'cy');
}

function gotoLine(line) {
  if (!S.sc || S.sc.mode !== 'editor') {
    toast('这道题是拼装模式，先按提示找第 ' + line + ' 行');
    return;
  }
  const ta = $('#editor');
  const lines = ta.value.split('\n');
  const n = Math.min(Math.max(1, line), lines.length);
  let idx = 0;
  for (let i = 0; i < n - 1; i++) idx += lines[i].length + 1;
  ta.focus();
  ta.setSelectionRange(idx, idx + lines[n - 1].length);
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 25;
  ta.scrollTop = Math.max(0, (n - 4) * lh);
  $('#gutter').scrollTop = ta.scrollTop;
}

/* ---------------- 运行 ---------------- */
function setRunMsg(t, cls) {
  const el = $('#run-msg');
  el.textContent = t;
  el.style.color = cls ? `var(--${cls})` : 'var(--dim)';
}

function term(rows) {
  const box = $('#term');
  box.innerHTML = '';
  const now = new Date();
  const stamp = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
  // 时间戳只标在这一批的第一行：每行都印一遍纯噪音，还挤掉横向空间
  rows.forEach((r, i) => {
    const d = document.createElement('div');
    d.className = 'row';
    const txt = r.t === '' ? ' ' : esc(r.t);
    d.innerHTML = `<span class="tm">${i === 0 ? stamp : ''}</span><span class="sp ${r.c || 'dm'}">${txt}</span>`;
    box.appendChild(d);
  });
  box.scrollTop = box.scrollHeight;
}

function classify(line) {
  if (/^error(\[|:)/.test(line)) return 'er';
  if (/^warning:/.test(line)) return 'wn';
  if (/^test .* \.\.\. ok/.test(line)) return 'ok';
  if (/^test .*\.\.\. FAILED/.test(line)) return 'er';
  if (/^test result: ok/.test(line)) return 'ok';
  if (/^test result: FAILED/.test(line)) return 'er';
  if (/^failures:/.test(line)) return 'er';
  if (/panicked at|assertion .* failed/.test(line)) return 'er';
  if (/\b(Compiling|Finished|running \d+ tests)\b/.test(line)) return 'dm';
  return 'dm';
}

function buildSource() {
  if (S.sc.mode === 'editor') return { src: $('#editor').value, complete: true, left: [] };
  const left = [];
  const src = S.sc.template.replace(/\{\{(\w+)\}\}/g, (_m, k) => {
    if (S.holes[k] == null) {
      left.push(k);
      return `{{${k}}}`;
    }
    return S.holes[k];
  });
  return { src, complete: left.length === 0, left };
}

/* ---------------- 在线演示判定（无本地桥时） ----------------
   在线版没有 cargo，不能真编译。拼装题的每个空位都有标准答案，
   所以可以等价判定「填对没填对」；自由编辑题做不了，如实说明。
   绝不伪造 rustc 诊断（那会把教学价值变成假话）。 */
function demoJudge() {
  const sc = S.sc;
  if (!sc || sc.mode === 'editor') return { unsupported: true };
  const slots = sc.slots || [];
  const empty = slots.filter((s) => S.holes[s.key] == null);
  if (empty.length) return { unsupported: false, empty };
  const wrong = slots.filter((s) => S.holes[s.key] !== s.answer);
  return { unsupported: false, empty: [], wrong };
}

function demoPass() {
  const names = (S.ex.tests || []).map((t) => 'tests::' + t.name);
  const head = `   Compiling ${S.ex.pkg} v0.1.0`;
  const body = names.length
    ? ['', `running ${names.length} tests`, ...names.map((n) => `test ${n} ... ok`), '', `test result: ok. ${names.length} passed; 0 failed`]
    : ['', '编译通过（这道题没有测试，编译成功即过关）'];
  return {
    ok: true, code: 0, durationMs: 160,
    tests: names.map((n) => ({ name: n, status: 'ok' })),
    passed: names.length, failed: 0, summaryOk: true,
    compileError: false, errorCode: null, errors: [],
    output: [head, ...body].join('\n'),
    demo: true,
  };
}

function demoFail(wrong) {
  const lines = [
    `   Compiling ${S.ex.pkg} v0.1.0`,
    '',
    `error: 还有 ${wrong.length} 个空位不对`,
    ...wrong.map((s) => `  · ${slotLabel(s.key)}`),
    '',
    '  在线演示版不做真实编译：判定依据是空位内容是否与标准实现一致。',
    '  想看真实的 rustc 诊断（移动轨迹 / 类型对撞 / 一键应用修复），把它 clone 下来用本地桥跑。',
  ];
  return {
    ok: false, code: 101, durationMs: 160, tests: [], passed: 0, failed: 0, summaryOk: false,
    compileError: false, errorCode: null, errors: [],
    output: lines.join('\n'),
    demo: true,
    wrong: wrong.map((s) => s.key),
  };
}

// 填错的空位标黄并拉到视野里，比"有 2 个空位不对"更好用
function markWrongHoles(keys) {
  $$('#code .hole').forEach((el) => el.classList.remove('warn'));
  for (const k of keys) {
    const el = $(`#code .hole[data-k="${k}"]`);
    if (el) el.classList.add('warn');
  }
  const first = $('#code .hole.warn');
  if (first) first.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function run() {
  if (S.running || !S.cur) return;
  if (!S.bridge) {
    // 在线演示版：拼装 / 开关题可以直接判定并结单，编辑器题如实拒绝
    const j = demoJudge();
    if (!j.unsupported) {
      const src = buildSource();
      if (!src.complete) {
        toast('还有 ' + src.left.length + ' 个空位：' + src.left.map(slotLabel).join('、'));
        return;
      }
      const btn = $('#run');
      btn.disabled = true;
      setRunMsg('判定中…');
      term([{ t: `$ 在线判定  (${S.cur})`, c: 'cy' }, { t: '   在线演示版不调用 cargo，按空位内容判定…', c: 'dm' }]);
      const res = j.wrong.length ? demoFail(j.wrong) : demoPass();
      setTimeout(() => {
        renderResult(res, res.durationMs);
        if (res.wrong) markWrongHoles(res.wrong);
        btn.disabled = false;
      }, 160);
      return;
    }
    term([
      { t: '$ cargo test', c: 'er' },
      { t: '在线演示版不编译代码 —— 这道题是自由编辑，没有可对比的标准空位。', c: 'er' },
      { t: '想看真实编译（含借用检查、真实测试），在仓库根目录运行：', c: 'cy' },
      { t: '  node bridge/server.mjs   →   http://127.0.0.1:7878', c: 'cy' },
    ]);
    toast('这道题需要本地编译');
    return;
  }
  const { src, complete, left } = buildSource();
  if (!complete) {
    toast('还有 ' + left.length + ' 个空位：' + left.map(slotLabel).join('、'));
    return;
  }

  // 一键修复用的字节偏移只对「这次送出去的源码」有效，改过就必须重跑
  S.lastRunSrc = src;
  S.running = true;
  const btn = $('#run');
  btn.disabled = true;
  setRunMsg('编译中…');
  term([{ t: `$ cargo test  (${S.cur})`, c: 'cy' }, { t: '   Compiling…', c: 'dm' }]);

  const started = Date.now();
  let res = null;
  try {
    const r = await fetch('api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: S.cur, source: src }),
    });
    res = await r.json();
    if (!r.ok) throw new Error(res.error || 'HTTP ' + r.status);
  } catch (e) {
    term([{ t: '$ cargo test', c: 'cy' }, { t: '✗ ' + e.message, c: 'er' }]);
    setRunMsg('请求失败', 'rs');
    S.running = false;
    btn.disabled = false;
    return;
  }

  renderResult(res, Date.now() - started);
  S.running = false;
  btn.disabled = false;
}

/* ---------------- 报错战斗 / 结单 ---------------- */
const LS_ERR = 'ticketops.errstat.v1';

// 同一个错误码反复踩就换更狠的话：第 1 次平铺直叙，第 2 次点破，第 3 次赶你回去看文档
const TAUNT = {
  E0382: ['值已经被移动走了，原变量在那一刻就作废', '又是 E0382。move 不是复制，值已经换主人了', '第三次了。值只有一个主人，move 一次就换人 —— 回去看 06_ownership'],
  E0502: ['同一时间既有可变借用又有不可变借用', '还是借用打架：读的和写的不能同时挂着', '第三次了。借用规矩只有一条 —— 共享不可变，或独占可变'],
  E0596: ['想改一个没声明 mut 的变量，或只拿到不可变借用', '又是 mut 的事。要改就得让它可变', '第三次了，`let` 后面补个 `mut`'],
  E0308: ['类型对不上，看两边是否一致', '类型还是不匹配，把两边的类型写出来对一遍', '第三次了。Rust 不做隐式转换，要么 `as`，要么 From/TryFrom'],
  E0603: ['访问了私有项，需要加 pub', '还是可见性：模块外看不到，就是不存在', '第三次了。没有 `pub` 的东西，出了模块就摸不到'],
  E0277: ['trait bound 不满足，这个类型没实现要求的 trait', '还是不满足 trait bound，缺一个 impl', '第三次了。回去看 04_traits 的 trait bounds 那一节'],
  E0499: ['同时存在两个可变借用', '两个 &mut 同时活着，编译器不放行', '第三次了。可变借用同一时间只能有一个'],
  E0716: ['临时值被释放了，但你还拿着它的借用', '临时值活不到你用它的下一行', '第三次了。先用 `let` 把它接住，别直接借临时值'],
};

function bumpErr(id, code) {
  if (!code) return 0;
  const book = lsLoad(LS_ERR, {});
  const one = book[id] || (book[id] = {});
  one[code] = (one[code] || 0) + 1;
  lsSave(LS_ERR, book);
  return one[code];
}

function fightLine(code, n, hint) {
  const rows = code && TAUNT[code];
  if (!rows) return hint || '编译没过，先把底下的错误看完';
  return n >= 3 ? rows[2] : n === 2 ? rows[1] : rows[0];
}

function renderFight(res) {
  const el = $('#fight');
  const errs = (res.errors || []).filter((e) => e.level === 'error');
  if (!errs.length || res.ok) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  const code = errs[0].code || '';
  const line = fightLine(code, bumpErr(S.cur, code), errs[0].hint);
  // 血条固定 6 格，亮的格 = 当前还剩几条编译错误
  const on = Math.min(errs.length, 6);
  const cells = Array.from({ length: 6 }, (_, i) => `<i class="${i < on ? '' : 'off'}"></i>`).join('');
  const extra = errs.length > 6 ? `<em>+${errs.length - 6}</em>` : '';
  el.innerHTML =
    `<span class="fc">${esc(code || 'ERROR')}</span>` +
    `<span class="ft">${esc(line)}</span>` +
    `<span class="hp" title="${errs.length} 条编译错误">${cells}${extra}</span>`;
  el.hidden = false;
}

function resetFx() {
  $('#fight').hidden = true;
  $('#fight').innerHTML = '';
  $('#close-scan').hidden = true;
  const st = $('#close-stamp');
  st.hidden = true;
  st.classList.remove('out');
  $('.panel-task').classList.remove('closed');
}

function countUp(el, from, to, ms) {
  const t0 = performance.now();
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    el.textContent = String(Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// 结单：一条绿扫描线滑过代码区 + 盖一枚戳 + 顶部数字滚动 + 记下待闪的星图节点
function closeTicket(chapterId, from, to) {
  const scan = $('#close-scan');
  const h = Math.round($('.panel-code').getBoundingClientRect().height);
  scan.hidden = false;
  clearTimeout(scan._t);
  // 用 Web Animations 而不是 CSS 动画：元素常驻 DOM，CSS 动画重播不可靠
  scan.animate(
    [
      { transform: 'translateY(0)', opacity: 0 },
      { opacity: 1, offset: 0.12 },
      { transform: `translateY(${h}px)`, opacity: 0 },
    ],
    { duration: 320, easing: 'cubic-bezier(.16,1,.3,1)' }
  );
  scan._t = setTimeout(() => { scan.hidden = true; }, 380);

  const st = $('#close-stamp');
  clearTimeout(st._t1);
  clearTimeout(st._t2);
  st.classList.remove('out');
  st.hidden = false;
  st._t1 = setTimeout(() => st.classList.add('out'), 1150);
  st._t2 = setTimeout(() => { st.hidden = true; st.classList.remove('out'); }, 1500);

  countUp($('#st-fixed'), from, to, 620);
  const task = $('.panel-task');
  task.classList.add('closed');
  clearTimeout(task._t);
  task._t = setTimeout(() => task.classList.remove('closed'), 1200);
  sessionStorage.setItem('ticketops.fresh', chapterId);
}

function renderResult(res, wall) {
  const lines = String(res.output || '').split('\n');

  // 先把每条验收的通过情况算出来，终端里才能点名「哪条没过」
  const got = new Map();
  for (const t of res.tests || []) {
    got.set(t.name, t.status);
    got.set(String(t.name).split('::').pop(), t.status);
  }
  const failed = (S.ex.tests || []).filter((t) => got.get(t.name) === 'FAILED');

  const rows = lines.slice(-80).map((l) => ({ t: l, c: classify(l) }));
  if (res.hint) rows.push({ t: '▸ 翻译：' + res.hint, c: 'mg' });
  if (res.ok) rows.push({ t: `✓ 工单 #${S.ex.no} 已结单 · ${(res.tests || []).length} 项验收全过`, c: 'ok' });
  // 失败时别让人去比对清单：直接点名没过的那几条，并把它在验什么说出来
  for (const t of failed) rows.push({ t: `✗ ${t.name} 没过 · ${t.detail || '见验收清单'}`, c: 'er' });
  if (failed.length) {
    const h = S.hints[S.cur];
    if (h) rows.push({ t: '▸ 这题在考：' + h.h1.replace(/`/g, ''), c: 'cy' });
    if (hintLevel(S.cur) < 3) rows.push({ t: '  左边的「给点提示」可以一级一级往下看', c: 'dm' });
  }
  rows.push({ t: '— ' + (res.durationMs || wall) + 'ms · exit ' + res.code + (res.demo ? ' · DEMO' : res.fake ? ' · FAKE' : ''), c: 'dm' });
  term(rows);
  renderProblems(res.errors);
  renderFight(res);
  // 编译失败时自动切到「问题」：结构化的错误列表比原始日志好读
  if (res.compileError) switchTab('problems');

  $$('#accept .ac').forEach((el) => {
    const name = el.dataset.t;
    el.classList.remove('done', 'fail');
    if (name === '__compile') {
      if (!res.compileError && res.code === 0) el.classList.add('done');
      else if (res.compileError) el.classList.add('fail');
      return;
    }
    const st = got.get(name);
    if (st === 'ok') el.classList.add('done');
    else if (st === 'FAILED') el.classList.add('fail');
  });

  // 清单长的时候失败条目可能滚出视野；有提示的题直接把视线带到「给点提示」上
  const firstFail = $('#accept .ac.fail');
  if (firstFail) {
    firstFail.animate(
      [
        { backgroundColor: 'rgba(251,113,133,.22)' },
        { backgroundColor: 'rgba(251,113,133,0)' },
      ],
      { duration: 900, easing: 'ease-out' }
    );
    const hintBox = $('#hint');
    const anchor = hintBox.hidden ? firstFail : hintBox;
    anchor.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const hb = $('#hint-btn');
    if (hb && !hintBox.hidden) hb.classList.add('nudge');
  }

  if (res.ok) {
    setRunMsg(res.demo ? '全部正确 · 工单已关闭（在线演示）' : '全部通过 · 工单已关闭', 'ok');
    success(res);
  } else if (res.wrong) {
    setRunMsg(`${res.wrong.length} 个空位不对 · 已标黄`, 'rs');
  } else if (res.compileError) {
    setRunMsg('编译失败' + (res.errorCode ? ' · ' + res.errorCode : ''), 'rs');
  } else {
    setRunMsg(`${res.passed} 通过 / ${res.failed} 失败`, 'rs');
  }
}

function success(res) {
  const id = S.cur;
  const before = Object.keys(S.prog).length;
  const first = !S.prog[id];
  S.prog[id] = { at: Date.now(), ms: res.durationMs };
  lsSave(LS_PROG, S.prog);
  const after = Object.keys(S.prog).length;
  const ch = S.data.chapters.find((c) => c.exercises.includes(id));

  // 首次通过 = 结单：扫描线 + 盖章 + 数字滚动 + 星图待闪；重复跑只更新数字
  if (first && ch) closeTicket(ch.id, before, after);
  else $('#st-fixed').textContent = after;

  const mismatch = (S.sc.slots || []).filter((s) => S.holes[s.key] != null && S.holes[s.key] !== s.answer);
  if (mismatch.length) {
    const b = $('#banner');
    b.hidden = false;
    b.innerHTML = `<b>测试全绿，但有 ${mismatch.length} 处和课程设定不同：</b>${mismatch
      .map((s) => esc(s.label))
      .join('、')}。测试没抓到这个差异，值得回看一眼。`;
  }

  if (first) {
    const node = document.createElement('div');
    node.className = 'xp';
    node.textContent = '+120 XP';
    node.style.left = '50%';
    node.style.top = '42%';
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 1300);
  }

  const i = ch.exercises.indexOf(id);
  const nxt = ch.exercises[i + 1];
  const nextBtn = $('#next');
  nextBtn.hidden = false;
  nextBtn.textContent = nxt ? '下一张 →' : '回到区域 →';
  nextBtn.onclick = () => (nxt ? openEx(nxt) : openChapter(ch.id));
}

/* ---------------- 文档抽屉 ---------------- */
function md(src) {
  const lines = String(src).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const inline = (s) =>
    esc(s)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/\*([^*]+)\*/g, '<i>$1</i>')
      .replace(/\[\^[^\]]*\]/g, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '');

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^```/.test(l)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(l);
      i += 2;
      const body = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) body.push(cells(lines[i++]));
      i--;
      out.push(
        `<table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${body
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`
      );
      continue;
    }
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }
    if (/^>\s?/.test(l)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      i--;
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(l)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) buf.push(inline(lines[i++].replace(/^\s*[-*]\s+/, '')));
      i--;
      out.push(`<ul>${buf.map((b) => `<li>${b}</li>`).join('')}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(l)) {
      const buf = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) buf.push(inline(lines[i++].replace(/^\s*\d+\.\s+/, '')));
      i--;
      out.push(`<ol>${buf.map((b) => `<li>${b}</li>`).join('')}</ol>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) {
      out.push('<hr>');
      continue;
    }
    if (!l.trim()) continue;
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|\s*[-*]\s|\s*\d+\.\s)/.test(lines[i])) {
      buf.push(inline(lines[i++]));
    }
    i--;
    out.push(`<p>${buf.join(' ')}</p>`);
  }
  return out.join('\n');
}

// 线上文档站：每题一个页，路径由内容管线写入 ex.docUrl（线上编号可能与本地不一致）
const DOC_BASE = 'https://colobu.com/rust100/';
function exDocUrl() {
  if (!S.ex) return null;
  return S.ex.docUrl === undefined ? DOC_BASE + S.ex.id + '.html' : S.ex.docUrl;
}

function openDocExternal() {
  const url = exDocUrl();
  if (!url) {
    toast('这一节线上文档站没有对应页，先用站内速览');
    openDoc();
    return;
  }
  window.open(url, '_blank', 'noopener');
}

function openDoc() {
  if (!S.ex || !S.ex.doc) {
    toast('这一节没有配套文档');
    return;
  }
  $('#drawer-t').textContent = `${S.ex.chapterTitle} · ${S.ex.title}`;
  $('#doc').innerHTML = md(S.ex.doc);
  const ext = $('#drawer-ext');
  const url = exDocUrl();
  if (url) {
    ext.href = url;
    ext.hidden = false;
  } else {
    ext.hidden = true;
  }
  $('#drawer').classList.add('open');
}

/* ---------------- 事件 ---------------- */
$('#bootgo').addEventListener('click', enter);
$('#about-btn').addEventListener('click', openAbout);
$('#nav-back').addEventListener('click', goBack);
$('#nav-fwd').addEventListener('click', goForward);
// 浏览器后退/前进（鼠标侧键、Alt+←）和 hash 变更都落到这一处
window.addEventListener('popstate', () => {
  const i = navIndex();
  NAV.max = Math.max(NAV.max, i); // 刷新后 max 归零，回退一次就能重新点亮「前进」
  restoreByHash();
  updateNavBtns();
});
$('#back-map').addEventListener('click', () => goMap());
$('#back-ch').addEventListener('click', () => openChapter(S.chapter));
$('#doc-btn').addEventListener('click', openDocExternal);
$('#hint-btn').addEventListener('click', unlockHint);
$('#doc-local').addEventListener('click', openDoc);
$('#drawer-x').addEventListener('click', () => $('#drawer').classList.remove('open'));
$('#run').addEventListener('click', run);
$('#reset').addEventListener('click', () => {
  if (S.sc.mode === 'editor') {
    $('#editor').value = S.sc.template;
    syncGutter();
  } else {
    S.holes = {};
    S.sel = null;
    renderCode();
  }
  $('#banner').hidden = true;
  localStorage.removeItem(LS_DRAFT + S.cur);
  setRunMsg('已重置');
  term([{ t: '$ reset', c: 'cy' }, { t: '  已回到初始状态', c: 'dm' }]);
});

document.addEventListener('keydown', (e) => {
  if (!$('#boot').hidden) {
    if (e.key === 'Enter' && !$('#bootgo').hidden) enter();
    else if (e.key === 'Escape' && entered) enter(); // 回看模式下 Esc 也能退出
    return;
  }
  // Ctrl + ` 折叠 / 展开底部面板（编辑框里也生效）
  if (e.ctrlKey && (e.key === '`' || e.key === '~')) {
    e.preventDefault();
    toggleFold();
    return;
  }
  if (e.key === 'Escape') {
    if ($('#drawer').classList.contains('open')) $('#drawer').classList.remove('open');
    else if (!$('#bench-screen').hidden) openChapter(S.chapter);
    return;
  }
  if ($('#bench-screen').hidden) return;
  if (e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'Enter') {
    e.preventDefault();
    run();
  }
  if ((e.key === 'Backspace' || e.key === 'Delete') && S.sel) {
    e.preventDefault();
    S.holes[S.sel] = null;
    renderCode();
    saveDraft();
  }
});

// 每条历史记录带一个索引，刷新后也能判断「还能不能前进」
if (typeof (history.state || {}).i !== 'number') history.replaceState({ i: 0 }, '');
NAV.max = navIndex();

main();
