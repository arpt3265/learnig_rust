#!/usr/bin/env node
// 本地桥：静态托管 web/ + 把网页里的源码写进临时 crate 并真的跑 cargo test
// 用法：node bridge/server.mjs [--port 7878] [--fake]
// --fake 不调用 cargo，返回合成结果（跨平台；TICKET_OPS_FAKE=1 仍然兼容）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const RUNS = path.join(ROOT, '.workbuddy', 'runs');
const DATA_FILE = path.join(WEB, 'data', 'exercises.json');

const argPort = process.argv.indexOf('--port');
const PORT = Number(argPort > -1 ? process.argv[argPort + 1] : process.env.PORT || 7878);
// --fake 优先走命令行：Windows 的 npm script 用 cmd，写不了 VAR=1 node 这种前缀
const FAKE = process.argv.includes('--fake') || process.env.TICKET_OPS_FAKE === '1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

let data = null;
function loadData() {
  data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  return data;
}

// ---------- 环境准备：临时 crate ----------
export function prepareCrate(ex) {
  const origDir = path.join(ROOT, 'exercises', ex.chapter, ex.slug);
  const cargoFile = path.join(origDir, 'Cargo.toml');
  if (!fs.existsSync(cargoFile)) throw new Error(`找不到 ${path.relative(ROOT, cargoFile)}`);

  const safe = (ex.chapter + '_' + ex.slug).replace(/[^\w.-]/g, '_');
  const dir = path.join(RUNS, safe);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });

  // 相对 path 依赖改绝对，并声明独立 workspace（否则会报 not a member of workspace）
  let cargo = fs.readFileSync(cargoFile, 'utf8').replace(
    /path\s*=\s*"([^"]+)"/g,
    (_m, p) => `path = ${JSON.stringify(path.resolve(origDir, p).split(path.sep).join('/'))}`
  );
  if (!/^\[workspace\]/m.test(cargo)) cargo += '\n[workspace]\n';
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), cargo);

  // 集成测试目录要一起带过去（12_outro 的测试在 tests/）
  const tDir = path.join(origDir, 'tests');
  if (fs.existsSync(tDir)) fs.cpSync(tDir, path.join(dir, 'tests'), { recursive: true });

  return { dir, srcFile: ex.srcFile === 'main' ? 'main.rs' : 'lib.rs' };
}

// ---------- 解析 cargo test 输出 ----------
export function parseCargo(raw) {
  const tests = [];
  // #[should_panic] 的测试会打成 "test tests::x - should panic ... ok"
  const re = /^test\s+(\S+)(?:\s+-\s+should panic)?\s+\.\.\.\s+(ok|FAILED|ignored)/gm;
  let m;
  while ((m = re.exec(raw))) tests.push({ name: m[1], status: m[2] });
  const summary = raw.match(/test result:\s+(\w+)\.\s+(\d+) passed;\s+(\d+) failed/);
  const firstError = raw.match(/^error(\[E\d+\])?:.*$/m);
  const compileError = !summary && !!firstError;
  return {
    tests,
    passed: summary ? Number(summary[2]) : 0,
    failed: summary ? Number(summary[3]) : 0,
    summaryOk: summary ? summary[1] === 'ok' : false,
    compileError,
    errorCode: firstError && firstError[1] ? firstError[1].slice(1, -1) : null,
  };
}

// cargo 的 JSON 流只说编译诊断；测试运行输出（libtest）仍是纯文本，两条流混在 stdout 里
const MAX_OUT = 400000;
function clip(s) {
  if (s.length <= MAX_OUT) return s;
  const cut = s.slice(-MAX_OUT);
  const nl = cut.indexOf('\n'); // 丢掉被截断的半行，否则首行 JSON 解析失败
  return nl === -1 ? cut : cut.slice(nl + 1);
}

function runCargo(dir, timeoutMs = 180000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(
      'cargo',
      ['test', '--color', 'never', '--message-format=json', '--manifest-path', path.join(dir, 'Cargo.toml')],
      {
        cwd: dir,
        env: {
          ...process.env,
          CARGO_TERM_COLOR: 'never',
          CARGO_TARGET_DIR: path.join(RUNS, '.target'),
          NO_COLOR: '1',
        },
        shell: process.platform === 'win32',
        windowsHide: true,
      }
    );
    let out = '';
    let done = false;
    const finish = (payload) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ...payload, durationMs: Date.now() - started });
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      finish({ code: -1, output: out + '\n[超时] 超过 ' + timeoutMs / 1000 + 's 已终止' });
    }, timeoutMs);

    child.stdout.on('data', (d) => { out = clip(out + d.toString()); });
    child.stderr.on('data', (d) => { out = clip(out + d.toString()); });
    child.on('error', (e) => finish({ code: -2, output: '无法启动 cargo：' + e.message }));
    child.on('close', (code) => finish({ code, output: out }));
  });
}

// FAKE 模式：用这道题真实的测试名合成输出，好让验收清单照常打勾（不编译）
function fakeRun(source, ex) {
  const broken = /\{\{\w+\}\}|todo!\(\)/.test(source);
  const names = (ex.tests || []).map((t) => 'tests::' + t.name);
  const list = names.length ? names : ['tests::demo'];
  const lines = list.map((n, i) => `test ${n} ... ${broken && i === 0 ? 'FAILED' : 'ok'}`);
  const head = `   Compiling demo v0.1.0\n\nrunning ${list.length} tests\n`;
  const tail = broken
    ? `\n\nfailures:\n\n---- ${list[0]} stdout ----\nthread panicked at src/lib.rs:9:9\nassertion failed\n\n\ntest result: FAILED. 1 passed; 1 failed\n`
    : `\n\ntest result: ok. ${list.length} passed; 0 failed\n`;
  return Promise.resolve({ code: broken ? 101 : 0, output: head + lines.join('\n') + tail, durationMs: 42 });
}

function translate(code) {
  const map = {
    E0382: '这个值已经被移动走了，后面不能再使用',
    E0596: '你想修改一个没有声明 mut 的变量，或者只有一个不可变借用',
    E0502: '同一时间既有可变借用又有不可变借用',
    E0308: '类型对不上，看看两边的类型是否一致',
    E0603: '访问了私有项，需要加 pub',
    E0624: '这个方法不是 pub，模块外调不到',
    E0433: '路径写错了，模块或项在这个位置不存在',
    E0277: 'trait bound 不满足，这个类型没实现要求的 trait',
    E0061: '参数个数不对',
    E0425: '用了不存在的变量或函数名',
    E0499: '同时存在两个可变借用',
    E0716: '临时值被释放了，但你还拿着它的借用',
  };
  return map[code] || null;
}

// cargo 输出拆成结构化错误，供网页的「问题」面板逐条列出
export function parseErrors(raw) {
  const lines = String(raw || '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(error|warning)(?:\[(E\d+|[A-Z]\d+)\])?:\s*(.+)$/);
    if (!m) continue;
    // 「could not compile」这类收尾行没有源码位置，跳过
    if (/could not compile/i.test(m[3])) continue;
    let loc = '';
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      const hit = lines[j].match(/^\s*-->\s+(\S+)$/);
      if (hit) { loc = hit[1]; break; }
    }
    out.push({
      level: m[1],
      code: m[2] || null,
      message: m[3].trim(),
      loc,
      line: loc ? Number((loc.match(/:(\d+)(?::\d+)?$/) || [])[1]) || null : null,
      hint: m[2] ? translate(m[2]) : null,
    });
  }
  return out;
}

// ---------- 结构化诊断（--message-format=json） ----------
// 一行一个事件；只有 compiler-message 是诊断，其余（artifact/build-finished）丢掉
export function splitStream(raw) {
  const text = [];
  const diags = [];
  for (const line of String(raw || '').split('\n')) {
    const t = line.trimStart();
    if (!t.startsWith('{')) { text.push(line); continue; }
    let ev;
    try { ev = JSON.parse(t); } catch { text.push(line); continue; }
    if (ev.reason === 'compiler-message' && ev.message && Array.isArray(ev.message.spans)) diags.push(ev.message);
  }
  return { text: text.join('\n'), diags };
}

// 同一份诊断会被 lib 和 lib test 两个 target 各报一遍，按位置去重
function diagKey(d) {
  const p = (d.spans || []).find((s) => s.is_primary) || (d.spans || [])[0];
  const at = p ? `${p.file_name}:${p.line_start}:${p.column_start}` : '';
  return [d.level, (d.code && d.code.code) || '', d.message, at].join('|');
}

// 只收编译器认为「可以直接改」的建议；MaybeIncorrect / HasPlaceholders 不给按钮
function pickFixes(d) {
  const found = [];
  const take = (spans) => {
    for (const s of spans || []) {
      if (!s.file_name || s.suggested_replacement == null) continue;
      if (s.suggestion_applicability !== 'MachineApplicable') continue;
      found.push({ start: s.byte_start, end: s.byte_end, text: s.suggested_replacement });
    }
  };
  take(d.spans);
  for (const c of d.children || []) take(c.spans);

  found.sort((a, b) => a.start - b.start);
  const kept = [];
  for (const f of found) {
    if (kept.length && f.start < kept[kept.length - 1].end) continue; // 重叠的丢掉后一个
    kept.push(f);
  }
  return kept;
}

// rustc 诊断 → 前端能直接渲染的形状（保留原始 rendered 供终端/详情用）
export function toProblem(d) {
  const spans = (d.spans || []).filter((s) => s.file_name && s.line_start);
  const primary = spans.find((s) => s.is_primary) || spans[0] || null;
  const code = d.code && d.code.code ? String(d.code.code) : null;
  const norm = (p) => String(p).replace(/\\/g, '/');
  return {
    level: d.level,
    code,
    message: d.message,
    label: (primary && primary.label) || null,
    loc: primary ? `${norm(primary.file_name)}:${primary.line_start}:${primary.column_start}` : '',
    line: primary ? primary.line_start : null,
    col: primary ? primary.column_start : null,
    // 其余 span = 「值在这被移走」「类型因为返回值而定」这类定位点
    spans: spans
      .filter((s) => s !== primary && s.label)
      .sort((a, b) => a.line_start - b.line_start)
      .map((s) => ({ line: s.line_start, col: s.column_start, label: s.label, loc: `${norm(s.file_name)}:${s.line_start}` })),
    children: (d.children || [])
      .filter((c) => c.message && ['help', 'note', 'warning'].includes(c.level))
      .map((c) => ({ level: c.level, message: c.message })),
    fixes: pickFixes(d),
    hint: code ? translate(code) : null,
    rendered: d.rendered || null,
  };
}

export function parseDiagnostics(raw) {
  const seen = new Set();
  const out = [];
  for (const d of splitStream(raw).diags) {
    if (d.level !== 'error' && d.level !== 'warning') continue; // failure-note / help 顶层条目不要
    const k = diagKey(d);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(toProblem(d));
  }
  return out;
}

// ---------- HTTP ----------
function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveStatic(req, res) {
  let p = decodeURIComponent(url.parse(req.url).pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(WEB, p);
  if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 404, 'not found', 'text/plain; charset=utf-8');
  }
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
}

const server = http.createServer(async (req, res) => {
  const { pathname } = url.parse(req.url);

  if (pathname === '/api/health') {
    return send(res, 200, JSON.stringify({ ok: true, fake: FAKE, root: ROOT, version: '0.1.0' }));
  }

  if (pathname === '/api/run' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let id, source;
      try {
        ({ id, source } = JSON.parse(raw));
      } catch {
        return send(res, 400, JSON.stringify({ error: 'body 不是合法 JSON' }));
      }
      const ex = (data || loadData()).exercises[id];
      if (!ex) return send(res, 404, JSON.stringify({ error: '没有这道题：' + id }));
      if (typeof source !== 'string' || !source.trim()) {
        return send(res, 400, JSON.stringify({ error: '源码为空' }));
      }

      try {
        const { dir, srcFile } = prepareCrate(ex);
        fs.writeFileSync(path.join(dir, 'src', srcFile), source);
        const r = FAKE ? await fakeRun(source, ex) : await runCargo(dir);
        // JSON 模式下 rustc 的详细诊断不在文本流里，要按 rendered 补回终端，否则终端只剩「could not compile」
        const { text, diags } = splitStream(r.output);
        const parsed = parseCargo(text);
        const diagnostics = diags.length ? parseDiagnostics(r.output) : [];
        // JSON 模式下文本流里没有 `error[E0308]:` 这行了，错误码要从诊断里补回来
        const firstCode = parsed.errorCode
          || (diagnostics.find((d) => d.level === 'error' && /^E\d+$/.test(d.code || '')) || {}).code
          || null;
        const renderedText = diagnostics.map((d) => d.rendered || '').join('');
        const tail = (text + '\n' + renderedText).replace(/\x1b\[[0-9;]*m/g, '').slice(-12000);
        send(res, 200, JSON.stringify({
          ok: !parsed.compileError && parsed.failed === 0 && r.code === 0,
          code: r.code,
          durationMs: r.durationMs,
          ...parsed,
          errorCode: firstCode,
          hint: firstCode ? translate(firstCode) : null,
          errors: diagnostics.length ? diagnostics : parseErrors(text),
          output: tail,
          fake: FAKE,
        }));
      } catch (e) {
        send(res, 500, JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  serveStatic(req, res);
});

// 直接运行才监听端口；被 import 时只提供 prepareCrate / parseCargo 供测试
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  loadData();
  fs.mkdirSync(RUNS, { recursive: true });

  // 自检：只准备 crate、不跑 cargo，用于确认 Cargo.toml 重写正确
  const argPrepare = process.argv.indexOf('--prepare');
  if (argPrepare > -1) {
    const id = process.argv[argPrepare + 1];
    const ex = data.exercises[id];
    if (!ex) {
      console.error('没有这道题：' + id);
      process.exit(1);
    }
    const { dir, srcFile } = prepareCrate(ex);
    fs.writeFileSync(path.join(dir, 'src', srcFile), ex.starter);
    console.log('prepared →', dir);
    console.log('src file →', srcFile);
    console.log('--- Cargo.toml ---');
    console.log(fs.readFileSync(path.join(dir, 'Cargo.toml'), 'utf8'));
    process.exit(0);
  }

  // 端口被占（上次的 bridge 没关）时自动依次试后面的端口
  let port = PORT;
  server.on('listening', () => {
    const p = server.address().port;
    console.log(`TICKET OPS bridge  →  http://127.0.0.1:${p}`);
    console.log(`  repo   ${ROOT}`);
    console.log(`  tickets ${data.total}`);
    console.log(FAKE ? '  mode   FAKE（不调用 cargo）' : '  mode   REAL（会真的编译）');
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && port < PORT + 10) {
      console.log(`  端口 ${port} 已被占用${port === PORT ? '（多半是上次的 bridge 还在跑）' : ''}，改用 ${port + 1}`);
      port += 1;
      server.listen(port, '127.0.0.1');
      return;
    }
    console.error(`bridge 启动失败：${err.message}`);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1');
}
