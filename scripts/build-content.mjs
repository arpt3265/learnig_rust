#!/usr/bin/env node
// 扫 exercises/ 与 book/src/，生成 web/data/exercises.json
// 规则：任务文案取自 lib.rs 顶部注释 / 首个 TODO 注释块；验收清单取自 assert 与 should_panic。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BOOK = path.join(ROOT, 'book', 'src');
const EX = path.join(ROOT, 'exercises');
const OUT = path.join(ROOT, 'web', 'data', 'exercises.json');

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');

// 练习源码优先取 git HEAD：本地工作区可能已经把 TODO 写完了，直接读会把答案当成起始代码
function readTracked(p) {
  const rel = path.relative(ROOT, p).split(path.sep).join('/');
  try {
    return execFileSync('git', ['show', 'HEAD:' + rel], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return read(p);
  }
}
const readdir = (p) => (fs.existsSync(p) ? fs.readdirSync(p, { withFileTypes: true }) : []);

// ---------- 1. SUMMARY.md → 章节与题目顺序 ----------
const summary = read(path.join(BOOK, 'SUMMARY.md'));
const chapters = [];
let current = null;
for (const line of summary.split(/\r?\n/)) {
  const m = line.match(/^(\s*)- \[(.+?)\]\((.+?)\.md\)/);
  if (!m) continue;
  const [, indent, title, rel] = m;
  const [dir, file] = rel.split('/');
  if (!indent.length) {
    // 顶层行既是章节标题，也常常是第一道题（如 - [Welcome](01_intro/00_welcome.md)）
    current = file ? { id: dir, title, entries: [{ slug: file, title }] } : null;
    if (current) chapters.push(current);
    continue;
  }
  if (current && file) current.entries.push({ slug: file, title });
}

// ---------- 2. Rust 源码小工具 ----------
// 跳过字符串/注释的字面量感知括号匹配，避免 panic!("{}") 之类把计数带偏
function matchBrace(src, open) {
  let depth = 0, str = false, esc = false, line = false, block = false, ch = false;
  for (let i = open; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
    if (str) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') str = false;
      continue;
    }
    if (ch) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === "'") ch = false; continue; }
    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { block = true; i++; continue; }
    if (c === '"') { str = true; continue; }
    if (c === "'" && src[i + 2] === "'") { ch = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return i; }
  }
  return -1;
}

function extractTests(src) {
  const out = [];
  const re = /#\[test\]/g;
  let m;
  while ((m = re.exec(src))) {
    const tail = src.slice(m.index);
    const fn = tail.match(/fn\s+([A-Za-z0-9_]+)\s*\(/);
    if (!fn) continue;
    const fnIdx = src.indexOf(fn[0], m.index);
    // 属性写在 #[test] 之后，只能向后看
    const attrs = src.slice(m.index, fnIdx);
    const brace = src.indexOf('{', fnIdx);
    if (brace < 0) continue;
    const close = matchBrace(src, brace);
    const body = close > 0 ? src.slice(brace + 1, close) : '';
    const panic = attrs.match(/#\[should_panic(?:\(expected\s*=\s*"((?:[^"\\]|\\.)*)"\))?\]/);
    let kind = 'assert', detail = '';
    if (panic) {
      kind = 'panic';
      detail = panic[1] || '';
    } else {
      const a = body.split('\n').map((l) => l.trim()).find((l) => l.startsWith('assert'));
      detail = (a || '').replace(/;$/, '');
    }
    out.push({ name: fn[1], kind, detail });
  }
  return out;
}

function extractTask(src) {
  const lines = src.split(/\r?\n/);
  const isC = (l) => /^\s*\/\//.test(l) && !/^\s*\/\/!/.test(l);
  // a) 顶部注释块
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (isC(lines[i])) { start = i; break; }
    break;
  }
  let block = [];
  if (start >= 0) {
    for (let i = start; i < lines.length && isC(lines[i]); i++) block.push(lines[i]);
  }
  // b) 没有顶部注释 → 找首个 TODO 注释块
  if (!block.length) {
    const i = lines.findIndex((l) => /^\s*\/\/\s*TODO/.test(l));
    if (i >= 0) for (let j = i; j < lines.length && isC(lines[j]); j++) block.push(lines[j]);
  }
  const text = block
    .map((l) => l.replace(/^\s*\/\/\s?/, '').replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, hasTodo: /TODO/i.test(text) };
}

// markdown 只做最小还原，渲染在浏览器端做
function loadDoc(chapterId, slug) {
  const p = path.join(BOOK, chapterId, `${slug}.md`);
  if (!fs.existsSync(p)) return null;
  return read(p);
}

// 线上中文文档站（colobu.com/rust100）的题号与本地不一定一致：线上缺节时后面的编号会整体前移，
// 所以按「去掉数字前缀的名字」对齐，不按序号。缓存由 npm run map 生成。
const DOC_MAP = (() => {
  try {
    return JSON.parse(read(path.join(ROOT, 'scripts', 'colobu-map.json')));
  } catch {
    return null;
  }
})();
const DOC_BASE = DOC_MAP?.base || 'https://colobu.com/rust100/';
const bareName = (s) => s.replace(/^\d+_/, '').replace(/\.html$/, '');

function docUrl(chapterId, slug) {
  const pages = DOC_MAP?.chapters?.[chapterId];
  if (!pages) return DOC_BASE + `${chapterId}/${slug}.html`; // 没抓过映射就按同名直拼
  const hit = pages.find((f) => bareName(f) === bareName(slug));
  return hit ? DOC_BASE + `${chapterId}/${hit}` : null;
}

// ---------- 3. 组装 ----------
const exercises = {};
let ticketNo = 0;
const outChapters = [];

for (const ch of chapters) {
  const items = [];
  for (const entry of ch.entries) {
    const dir = path.join(EX, ch.id, entry.slug);
    if (!fs.existsSync(dir)) continue;
    const src = readTracked(path.join(dir, 'src', 'lib.rs'));
    const binSrc = src ? '' : readTracked(path.join(dir, 'src', 'main.rs'));
    if (!src && !binSrc) continue;
    const source = src || binSrc;
    const srcFile = src ? 'lib' : 'main';
    const cargo = read(path.join(dir, 'Cargo.toml'));
    const pkg = (cargo.match(/^\s*name\s*=\s*"(.+?)"/m) || [, entry.slug])[1];
    const deps = [...cargo.matchAll(/^\s*([a-z0-9_-]+)\s*=\s*\{\s*path\s*=/gm)].map((x) => x[1]);

    // 集成测试（12_outro 那种）
    let tests = extractTests(source);
    const testDir = path.join(dir, 'tests');
    for (const f of readdir(testDir)) {
      if (!f.isFile() || !f.name.endsWith('.rs')) continue;
      tests = tests.concat(extractTests(readTracked(path.join(testDir, f.name))));
    }
    const task = extractTask(source);
    ticketNo++;

    exercises[`${ch.id}/${entry.slug}`] = {
      id: `${ch.id}/${entry.slug}`,
      no: ticketNo,
      chapter: ch.id,
      chapterTitle: ch.title,
      slug: entry.slug,
      title: entry.title,
      pkg,
      deps,
      task: task.text,
      hasTodo: task.hasTodo,
      starter: source,
      srcFile,
      tests,
      testCount: tests.length,
      hasIntegrationTests: readdir(testDir).length > 0,
      doc: loadDoc(ch.id, entry.slug),
      docUrl: docUrl(ch.id, entry.slug),
    };
    items.push(`${ch.id}/${entry.slug}`);
  }
  if (items.length) outChapters.push({ id: ch.id, title: ch.title, exercises: items });
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(
  OUT,
  JSON.stringify({ generatedAt: new Date().toISOString(), total: ticketNo, chapters: outChapters, exercises }, null, 0)
);

// 内存透视是手写的教学数据（scripts/memory.src.mjs），单独出一份 JSON
const MEM_OUT = path.join(ROOT, 'web', 'data', 'memory.json');
const { MEMORY } = await import('./memory.src.mjs');
const memIds = Object.keys(MEMORY).filter((k) => exercises[k]);
fs.writeFileSync(MEM_OUT, JSON.stringify({ generatedAt: new Date().toISOString(), items: MEMORY }, null, 0));
const dropped = Object.keys(MEMORY).length - memIds.length;
console.log(`✓ 内存透视 ${memIds.length} 题 → ${path.relative(ROOT, MEM_OUT)}`);
if (dropped) console.log(`! ${dropped} 条内存数据找不到对应题目，检查 key 是否写错`);

// 分级提示也是手写内容（scripts/hints.src.mjs）
const HINT_OUT = path.join(ROOT, 'web', 'data', 'hints.json');
const { HINTS } = await import('./hints.src.mjs');
const hintIds = Object.keys(HINTS).filter((k) => exercises[k]);
const badHints = Object.keys(HINTS).filter((k) => !exercises[k]);
fs.writeFileSync(HINT_OUT, JSON.stringify({ generatedAt: new Date().toISOString(), items: HINTS }, null, 0));
console.log(`✓ 分级提示 ${hintIds.length} 题 → ${path.relative(ROOT, HINT_OUT)}`);
if (badHints.length) console.log(`! 提示的 key 找不到对应题目：${badHints.join(', ')}`);

const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`✓ ${ticketNo} 道题 / ${outChapters.length} 章 → ${path.relative(ROOT, OUT)} (${kb} KB)`);
const orphans = Object.values(exercises).filter((e) => !e.docUrl).map((e) => e.id);
if (orphans.length) console.log(`! ${orphans.length} 题在线上文档站没有对应页（沿用站内速览）：${orphans.join(', ')}`);
if (!DOC_MAP) console.log('! 没有 scripts/colobu-map.json，文档链接按同名直拼；跑 npm run map 可修正编号偏移');
const sample = exercises['03_ticket_v1/02_validation'];
console.log('抽样 02_validation:', JSON.stringify({ task: sample.task.slice(0, 60), tests: sample.tests.slice(0, 2) }, null, 2));
