#!/usr/bin/env node
// 抓取 colobu.com/rust100 的目录结构缓存到 scripts/colobu-map.json
// 用途：build-content 据此把「本地题号」映射到「线上页」，两边编号可能不一致（线上少节会整体前移）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'colobu-map.json');
const BASE = 'https://colobu.com/rust100/';

const res = await fetch(BASE, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; ticket-ops/0.1)' } });
if (!res.ok) {
  console.error(`✗ 抓取失败：HTTP ${res.status}`);
  process.exit(1);
}
const html = await res.text();

const chapters = {};
let order = 0;
for (const m of html.matchAll(/href="([^"]+?\.html)"/g)) {
  const href = m[1];
  const hit = href.match(/^(\d\d_[a-z0-9_]+)\/(\d\d_[a-z0-9_]+\.html)$/);
  if (!hit) continue;
  const [, ch, file] = hit;
  const list = (chapters[ch] ||= []);
  if (!list.includes(file)) list.push(file);
  order++;
}
if (!order) {
  console.error('✗ 没有解析到任何章节链接，页面结构可能变了');
  process.exit(1);
}

const total = Object.values(chapters).reduce((n, l) => n + l.length, 0);
const payload = { base: BASE, fetchedAt: new Date().toISOString(), total, chapters };
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');
console.log(`✓ ${Object.keys(chapters).length} 章 / ${total} 页 → ${path.relative(process.cwd(), OUT)}`);
