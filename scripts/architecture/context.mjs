#!/usr/bin/env node
/**
 * 模块阅读包生成器（ZCode 能力内化 · P 线 P2）
 *
 * 用法：node scripts/architecture/context.mjs <module-id> [--write]
 *   <module-id>：architecture-policy.json 中的模块 id
 *   --write   ：同时落到 docs/reading-packs/<module-id>.md（默认仅 stdout）
 *
 * 输出：文件清单（行数） / 公开契约面（Rust=lib.rs 的 pub 项；TS=index.ts 导出） /
 *       依赖与被依赖（policy requires）/ 测试位置 / 文档指针
 * 退出码：0 成功 / 2 用法或未知模块
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const POLICY = path.join(ROOT, 'architecture-policy.json');
const posix = (p) => p.split(path.sep).join('/');

function walk(dir, excludeDirs, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (excludeDirs.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, excludeDirs, out);
    else out.push(p);
  }
  return out;
}

function rustContracts(root, module) {
  const lib = module.roots.map((r) => path.join(root, r, 'lib.rs')).find((p) => fs.existsSync(p)) ?? null;
  if (!lib) return ['（未找到 src/lib.rs——以各模块文件头注释为准）'];
  const re = /^pub (?:async )?(?:mod|use|fn|struct|enum|trait|const|static|type)\b[^;{=]*/gm;
  const lines = [];
  let m;
  while ((m = re.exec(fs.readFileSync(lib, 'utf8'))) !== null) lines.push(m[0].trim().replace(/\s+/g, ' ').slice(0, 120));
  return lines.length ? lines : ['（lib.rs 无顶层 pub 项）'];
}

function tsContracts(root, module) {
  const idx = module.roots.map((r) => path.join(root, r, 'index.ts')).find((p) => fs.existsSync(p)) ?? null;
  if (!idx) return ['（未找到 src/index.ts——以包 exports 与各模块文件头注释为准）'];
  const text = fs.readFileSync(idx, 'utf8');
  const names = new Set();
  for (const m of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const n of m[1].split(',')) {
      const t = n.trim().split(/\s+as\s+/).pop()?.trim();
      if (t) names.add(t);
    }
  }
  for (const m of text.matchAll(/export\s+(?:declare\s+)?(?:const|let|function|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  const out = [...names].slice(0, 80);
  const stars = [...text.matchAll(/export\s+\*\s+from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  if (stars.length) out.push(`… re-export：${stars.join(' / ')}`);
  return out.length ? out : ['（index.ts 无导出）'];
}

function main() {
  const args = process.argv.slice(2);
  const id = args.find((a) => !a.startsWith('--'));
  const write = args.includes('--write');
  if (!id) {
    console.error('用法：node scripts/architecture/context.mjs <module-id> [--write]');
    process.exit(2);
  }
  const policy = JSON.parse(fs.readFileSync(POLICY, 'utf8'));
  const module = policy.modules.find((m) => m.id === id);
  if (!module) {
    console.error(`未知模块 id：${id}（已在 policy 登记的模块：${policy.modules.map((m) => m.id).join(', ')}）`);
    process.exit(2);
  }
  const excludeDirs = new Set(policy.global.excludeDirs);
  const exts = new Set(policy.global.scanExtensions);

  const files = [];
  for (const r of module.roots) {
    for (const abs of walk(path.join(ROOT, r), excludeDirs)) {
      if (!exts.has(path.extname(abs))) continue;
      const rel = posix(path.relative(ROOT, abs));
      files.push({ rel, lines: fs.readFileSync(abs, 'utf8').split('\n').length });
    }
  }
  files.sort((a, b) => b.lines - a.lines);
  const totalLines = files.reduce((s, f) => s + f.lines, 0);

  const tests = files.filter((f) => /(^|\/)(tests?|__tests__)\//.test(f.rel) || /(_tests?|\.spec\.|\.test\.)[^/]*$/.test(f.rel));

  const depOn = module.requires ?? [];
  const dependedBy = policy.modules.filter((m) => (m.requires ?? []).includes(module.id)).map((m) => m.id);

  // 文档指针：docs/details 下文件名含模块目录名，或内容提及模块根路径
  const docHits = [];
  const moduleDirName = module.roots[0].split('/').filter(Boolean).pop() === 'src' ? module.roots[0].split('/').filter(Boolean).slice(-2, -1)[0] : module.roots[0];
  const cratesOrPackages = module.roots[0].split('/').slice(0, 2).join('/');
  for (const abs of walk(path.join(ROOT, 'docs', 'details'), excludeDirs)) {
    if (path.extname(abs) !== '.md') continue;
    const rel = posix(path.relative(ROOT, abs));
    if (rel.includes(moduleDirName) || rel.includes(module.id)) {
      docHits.push(rel);
      continue;
    }
    try {
      if (fs.readFileSync(abs, 'utf8').includes(cratesOrPackages)) docHits.push(rel);
    } catch {
      /* 跳过不可读 */
    }
  }

  const contracts = module.kind === 'rust' ? rustContracts(ROOT, module) : tsContracts(ROOT, module);

  const L = [];
  L.push(`# 阅读包：${module.id}`);
  L.push('');
  L.push(`> 生成物（\`node scripts/architecture/context.mjs ${module.id}\`）——**可能滞后于代码**，实时口径以命令输出为准。`);
  L.push(`> kind: ${module.kind} · roots: ${module.roots.join(' / ')} · manifest: ${module.manifest ?? '—'}`);
  L.push('');
  L.push(`## 文件清单（${files.length} 个 / 共 ${totalLines} 行）`);
  L.push('');
  L.push('| 行数 | 文件 |');
  L.push('|---|---|');
  for (const f of files.slice(0, 100)) L.push(`| ${f.lines} | ${f.rel} |`);
  if (files.length > 100) L.push(`| … | （其余 ${files.length - 100} 个省略，完整清单跑实时命令） |`);
  L.push('');
  L.push(`## 公开契约面（${module.kind === 'rust' ? 'src/lib.rs 的 pub 项' : 'src/index.ts 的导出'}）`);
  L.push('');
  for (const c of contracts) L.push(`- ${c}`);
  L.push('');
  L.push('## 依赖与被依赖');
  L.push('');
  L.push(`- 依赖（requires）：${depOn.length ? depOn.join(' · ') : '（无）'}`);
  L.push(`- 被依赖：${dependedBy.length ? dependedBy.join(' · ') : '（无）'}`);
  L.push('');
  L.push(`## 测试位置（${tests.length} 个）`);
  L.push('');
  for (const t of tests.slice(0, 30)) L.push(`- ${t.rel}（${t.lines} 行）`);
  if (tests.length > 30) L.push(`- …（其余 ${tests.length - 30} 个省略）`);
  if (!tests.length) L.push('- （模块根内未发现测试文件）');
  L.push('');
  L.push(`## 文档指针（${docHits.length} 处）`);
  L.push('');
  for (const d of docHits.slice(0, 8)) L.push(`- ${d}`);
  if (docHits.length > 8) L.push(`- …（其余 ${docHits.length - 8} 处省略）`);
  if (!docHits.length) L.push('- （无命中——建议为该模块补一份 design 注释）');
  L.push('');

  const text = L.join('\n');
  console.log(text);
  if (write) {
    const outDir = path.join(ROOT, 'docs', 'reading-packs');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `${module.id}.md`);
    fs.writeFileSync(outFile, text, 'utf8');
    console.error(`已写入 ${posix(path.relative(ROOT, outFile))}（${text.split('\n').length} 行）`);
  }
}

main();
