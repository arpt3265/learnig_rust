#!/usr/bin/env node
// 把 scenarios.src.mjs 的锚点替换真实落到 lib.rs 上，校验后产出 web/data/scenarios.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS } from './scenarios.src.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'web', 'data');
const exercises = JSON.parse(fs.readFileSync(path.join(DATA, 'exercises.json'), 'utf8'));

const errors = [];
const out = {};
let patched = 0;
const norm = (s) => s.replace(/\r\n/g, '\n');

for (const [id, sc] of Object.entries(SCENARIOS)) {
  const ex = exercises.exercises[id];
  if (!ex) {
    errors.push(`${id}: exercises.json 里没有这道题`);
    continue;
  }
  let template = sc.base ? sc.base : norm(ex.starter);

  for (const [find, replace] of sc.edits || []) {
    const hits = template.split(norm(find)).length - 1;
    if (hits !== 1) {
      errors.push(`${id}: 锚点命中 ${hits} 次（应为 1）→ ${JSON.stringify(find.slice(0, 60))}`);
      continue;
    }
    template = template.replace(norm(find), norm(replace));
    patched++;
  }

  // 槽位与占位符必须一一对应
  const placeholders = [...template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
  const keys = (sc.slots || []).map((s) => s.key);
  const missing = keys.filter((k) => !placeholders.includes(k));
  const extra = placeholders.filter((p) => !keys.includes(p));
  if (missing.length) errors.push(`${id}: 模板里找不到占位符 ${missing.join(',')}`);
  if (extra.length) errors.push(`${id}: 占位符 ${extra.join(',')} 没有对应槽位`);
  if (new Set(placeholders).size !== placeholders.length) {
    errors.push(`${id}: 占位符重复 ${placeholders.join(',')}`);
  }

  out[id] = { mode: sc.mode, label: sc.label, template, slots: sc.slots || [] };
}

if (errors.length) {
  console.error('✗ 构建失败：');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

fs.writeFileSync(path.join(DATA, 'scenarios.json'), JSON.stringify(out, null, 0));
const modes = Object.values(out).reduce((a, s) => ((a[s.mode] = (a[s.mode] || 0) + 1), a), {});
console.log(`✓ ${Object.keys(out).length} 道题剧本 / ${patched} 处锚点替换 → web/data/scenarios.json`);
console.log('  模式分布:', JSON.stringify(modes));
