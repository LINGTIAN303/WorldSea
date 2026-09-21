#!/usr/bin/env node
/**
 * 架构检查器（ZCode 能力内化 · P 线 P1）
 *
 * 依据 architecture-policy.json 执行四类检查：
 *   ① registry   模块登记：discovery 目录必须已登记；登记项（roots/manifest）必须存在
 *   ② file-size  文件规模：新建文件 ≤ 上限；存量超限文件按 architecture-baseline.json 冻结、只禁增长
 *   ③ rust-edge  Rust path 依赖边：必须在该模块 requires 白名单内（新增跨模块依赖先登记）
 *   ④ ts-edge    TS 跨包依赖边：必须在该模块 requires 白名单内（镜像 rust-edge）
 *   ⑤ ts-cycle   TS 包级依赖环：@worldsea/* 与相对导入构成的包图不得成环
 *
 * 用法：node scripts/architecture/check.mjs [--changed] [--update-baseline] [--self-test]
 * 退出码：0 无违规 / 1 有违规 / 2 用法或环境错误
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..', '..');
const POLICY_NAME = 'architecture-policy.json';
const BASELINE_NAME = 'architecture-baseline.json';
const posix = (p) => p.split(path.sep).join('/');

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function countLines(file) {
  return fs.readFileSync(file, 'utf8').split('\n').length;
}

function walkFiles(root, dirs, { extensions, excludeDirs }, out = []) {
  for (const dir of dirs) {
    const abs = path.join(root, dir);
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (excludeDirs.has(e.name)) continue;
      const p = path.join(abs, e.name);
      if (e.isDirectory()) walkFiles(root, [path.relative(root, p)], { extensions, excludeDirs }, out);
      else if (extensions.has(path.extname(e.name))) out.push(p);
    }
  }
  return out;
}

/** 文件规模上限：命中 overrides 取覆盖值，否则取全局值 */
function limitFor(rel, global) {
  for (const o of global.overrides ?? []) {
    if (rel.includes(o.match)) return o.maxFileLines;
  }
  return global.maxFileLines;
}

/** ① 模块登记 */
function checkRegistry(root, policy) {
  const violations = [];
  const discovered = [];
  const containers = [];
  for (const entry of policy.global.discoveryRoots) {
    const abs = path.join(root, entry);
    if (!fs.existsSync(abs)) {
      if (entry.includes('/') || entry.includes(path.sep)) containers.push(entry);
      continue;
    }
    let children;
    try {
      children = fs.readdirSync(abs, { withFileTypes: true }).filter((e) => e.isDirectory());
    } catch {
      continue;
    }
    const isContainerRoot = ['crates', 'packages', 'apps'].includes(entry) || entry === 'crates/vendor';
    if (isContainerRoot) {
      for (const c of children) {
        const rel = posix(path.join(entry, c.name));
        if (policy.global.discoveryRoots.includes(rel)) continue; // 容器自身跳过
        discovered.push(rel);
      }
    } else {
      discovered.push(entry);
    }
  }
  for (const rel of discovered) {
    const covered = policy.modules.some((m) => m.roots.some((r) => r.startsWith(rel + '/')));
    if (!covered) violations.push({ check: 'registry', key: `unregistered:${rel}`, message: `模块目录未登记：${rel}（请在 ${POLICY_NAME} 登记）` });
  }
  for (const m of policy.modules) {
    for (const r of m.roots) {
      if (!fs.existsSync(path.join(root, r))) violations.push({ check: 'registry', key: `missing-root:${m.id}:${r}`, message: `登记失效：模块 ${m.id} 的 root 不存在：${r}` });
    }
    if (m.manifest && !fs.existsSync(path.join(root, m.manifest))) violations.push({ check: 'registry', key: `missing-manifest:${m.id}`, message: `登记失效：模块 ${m.id} 的 manifest 不存在：${m.manifest}` });
  }
  return violations;
}

/** ② 文件规模（返回违规与本轮"超限文件快照"） */
function checkFileSize(root, policy, baseline, changedSet) {
  const violations = [];
  const overLimit = {};
  const global = policy.global;
  const extensions = new Set(global.scanExtensions);
  const excludeDirs = new Set(global.excludeDirs);
  const frozen = baseline.files ?? {};
  for (const m of policy.modules) {
    const files = walkFiles(root, m.roots, { extensions, excludeDirs });
    for (const abs of files) {
      const rel = posix(path.relative(root, abs));
      const lines = countLines(abs);
      const limit = limitFor(rel, global);
      if (lines > limit) overLimit[rel] = lines;
      if (changedSet && !changedSet.has(rel)) continue;
      const base = frozen[rel];
      if (base !== undefined) {
        if (lines > base) violations.push({ check: 'file-size', key: `growth:${rel}`, message: `${rel} 增长到 ${lines} 行（存量冻结 ${base} 行；拆分为宜）` });
      } else if (lines > limit) {
        violations.push({ check: 'file-size', key: `over:${rel}`, message: `${rel} 共 ${lines} 行，超过上限 ${limit} 行` });
      }
    }
  }
  return { violations, overLimit };
}

/** 按绝对路径反查所属模块 */
function moduleOfPath(root, policy, abs) {
  for (const m of policy.modules) {
    for (const r of m.roots) {
      const rootAbs = path.join(root, r);
      if (abs === rootAbs || abs.startsWith(rootAbs + path.sep)) return m;
    }
  }
  return null;
}

/** ③ Rust 依赖边 */
function checkRustEdges(root, policy) {
  const violations = [];
  for (const m of policy.modules) {
    if (m.kind !== 'rust' || !m.manifest) continue;
    const manifestAbs = path.join(root, m.manifest);
    if (!fs.existsSync(manifestAbs)) continue;
    const text = fs.readFileSync(manifestAbs, 'utf8');
    const re = /path\s*=\s*"([^"]+)"/g;
    let match;
    while ((match = re.exec(text)) !== null) {
      const targetAbs = path.resolve(path.dirname(manifestAbs), match[1]);
      // 精确匹配：path 依赖通常指向 crate 根目录（manifest 所在目录）；否则退回包含判定
      const target =
        policy.modules.find((x) => x.manifest && path.resolve(root, path.dirname(x.manifest)) === targetAbs) ??
        moduleOfPath(root, policy, targetAbs);
      if (!target) {
        if (targetAbs.startsWith(root)) violations.push({ check: 'rust-edge', key: `unknown:${m.id}:${match[1]}`, message: `${m.id} 的依赖指向未登记目录：${match[1]}（${posix(path.relative(root, targetAbs))}）` });
        continue;
      }
      if (target.id === m.id) continue;
      const allowed = m.requires ?? [];
      if (!allowed.includes(target.id)) violations.push({ check: 'rust-edge', key: `edge:${m.id}->${target.id}`, message: `${m.id} 依赖 ${target.id} 未在 requires 白名单（新增依赖先在 ${POLICY_NAME} 登记）` });
    }
  }
  return violations;
}

/** TS 导入提取（import/export-from、裸 import 与动态 import） */
function extractTsSpecifiers(file) {
  const text = fs.readFileSync(file, 'utf8');
  const out = [];
  const staticRe = /(?:import|export)\b[^;'"]*?from\s*['"]([^'"]+)['"]/g;
  const bareRe = /import\s*['"]([^'"]+)['"]/g;
  const dynamicRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const re of [staticRe, bareRe, dynamicRe]) {
    let mm;
    while ((mm = re.exec(text)) !== null) out.push(mm[1]);
  }
  return out;
}

/** TS 模块间依赖边采集（④ 与 ⑤ 共用） */
function collectTsEdges(root, policy) {
  const tsModules = policy.modules.filter((m) => m.kind === 'ts' && m.manifest);
  const nameToModule = new Map();
  for (const m of tsModules) {
    try {
      const pkg = loadJson(path.join(root, m.manifest));
      if (pkg.name) nameToModule.set(pkg.name, m);
    } catch {
      /* manifest 缺失已在 registry 报红 */
    }
  }
  const edges = new Map(); // moduleId -> Set(moduleId)
  const extensions = new Set(policy.global.scanExtensions);
  const excludeDirs = new Set(policy.global.excludeDirs);
  for (const m of tsModules) {
    const set = edges.get(m.id) ?? new Set();
    edges.set(m.id, set);
    for (const abs of walkFiles(root, m.roots, { extensions, excludeDirs })) {
      for (const spec of extractTsSpecifiers(abs)) {
        let target = null;
        if (spec.startsWith('.')) {
          const resolved = path.resolve(path.dirname(abs), spec);
          target = moduleOfPath(root, policy, resolved);
        } else if (!spec.startsWith('node:') && !spec.startsWith('http')) {
          const pkgName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
          target = nameToModule.get(pkgName) ?? null;
        }
        if (target && target.id !== m.id) set.add(target.id);
      }
    }
  }
  return edges;
}

/** ④ TS 依赖边白名单（镜像 rust-edge：新增跨包依赖先登记） */
function checkTsEdges(root, policy) {
  const violations = [];
  const edges = collectTsEdges(root, policy);
  for (const m of policy.modules) {
    if (m.kind !== 'ts') continue;
    const allowed = m.requires ?? [];
    for (const to of edges.get(m.id) ?? []) {
      if (!allowed.includes(to)) violations.push({ check: 'ts-edge', key: `tedge:${m.id}->${to}`, message: `${m.id} 依赖 ${to} 未在 requires 白名单（新增依赖先在 ${POLICY_NAME} 登记）` });
    }
  }
  return violations;
}

/** ⑤ TS 包级环 */
function checkTsCycles(root, policy) {
  const tsModules = policy.modules.filter((m) => m.kind === 'ts' && m.manifest);
  const edges = collectTsEdges(root, policy);
  // DFS 找环（去重：按环内节点排序作 key）
  const violations = [];
  const seen = new Set();
  const state = new Map();
  const stack = [];
  const dfs = (id) => {
    state.set(id, 1);
    stack.push(id);
    for (const next of edges.get(id) ?? []) {
      if (state.get(next) === 1) {
        const cycle = stack.slice(stack.indexOf(next)).concat(next);
        const key = [...new Set(cycle)].sort().join('|');
        if (!seen.has(key)) {
          seen.add(key);
          violations.push({ check: 'ts-cycle', key: `cycle:${key}`, message: `TS 包级依赖环：${cycle.join(' → ')}` });
        }
      } else if (!state.has(next)) dfs(next);
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const m of tsModules) if (!state.has(m.id)) dfs(m.id);
  return violations;
}

/** 汇总 */
function runChecks(root, policy, baseline, opts = {}) {
  const changedSet = opts.changedSet ?? null;
  const baselineForRun = opts.ignoreBaseline ? { files: {}, other: [] } : baseline;
  const registry = checkRegistry(root, policy);
  const { violations: fileSize, overLimit } = checkFileSize(root, policy, baselineForRun, changedSet);
  const rustEdges = checkRustEdges(root, policy);
  const tsEdges = checkTsEdges(root, policy);
  const tsCycles = checkTsCycles(root, policy);
  let all = [...registry, ...fileSize, ...rustEdges, ...tsEdges, ...tsCycles];
  if (!opts.ignoreBaseline) {
    const otherKeys = new Set((baseline.other ?? []).map((o) => `${o.check}::${o.key}`));
    all = all.filter((v) => !otherKeys.has(`${v.check}::${v.key}`));
  }
  return { violations: all, overLimit };
}

function getChangedSet(root) {
  const diff = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  const set = new Set();
  for (const line of (diff + '\n' + untracked).split('\n')) {
    const t = line.trim();
    if (t) set.add(posix(t));
  }
  return set;
}

function report(label, violations, overLimit, mode, baselineCount) {
  console.log(`== 架构检查（模式：${mode}） ==`);
  if (violations.length === 0) {
    console.log('✅ 无违规');
  } else {
    for (const v of violations) console.log(`❌ [${v.check}] ${v.message}`);
  }
  const frozen = Object.keys(overLimit).length;
  console.log(`— 违规 ${violations.length} 项 · 存量超限文件 ${frozen} 个${baselineCount !== undefined ? `（基线冻结 ${baselineCount} 个）` : ''} · ${label}`);
  return violations.length === 0 ? 0 : 1;
}

/** --self-test：夹具反证（临时目录内构造正/反例，不触碰本仓） */
function selfTest() {
  const cases = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archcheck-'));
  const write = (rel, content) => {
    const abs = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  };
  const policy = {
    version: 1,
    global: {
      maxFileLines: 5,
      overrides: [{ match: 'tests', maxFileLines: 8 }],
      scanExtensions: ['.rs', '.ts'],
      excludeDirs: ['node_modules'],
      discoveryRoots: ['crates', 'packages'],
    },
    modules: [
      { id: 'mod-a', kind: 'rust', roots: ['crates/mod-a/src'], manifest: 'crates/mod-a/Cargo.toml', requires: [] },
      { id: 'mod-b', kind: 'rust', roots: ['crates/mod-b/src'], manifest: 'crates/mod-b/Cargo.toml', requires: ['mod-a'] },
      { id: 'pkg-x', kind: 'ts', roots: ['packages/pkg-x/src'], manifest: 'packages/pkg-x/package.json', requires: ['pkg-y'] },
      { id: 'pkg-y', kind: 'ts', roots: ['packages/pkg-y/src'], manifest: 'packages/pkg-y/package.json', requires: [] },
    ],
  };
  write('crates/mod-a/src/lib.rs', 'a\n');
  write('crates/mod-a/Cargo.toml', '[package]\nname = "mod-a"\n');
  write('crates/mod-b/src/lib.rs', 'b\n');
  write('crates/mod-b/Cargo.toml', '[dependencies]\nmod-a = { path = "../mod-a" }\n');
  write('packages/pkg-x/src/index.ts', "export const x = 1;\n");
  write('packages/pkg-x/package.json', JSON.stringify({ name: '@fixture/pkg-x' }));
  write('packages/pkg-y/src/index.ts', "export const y = 1;\n");
  write('packages/pkg-y/package.json', JSON.stringify({ name: '@fixture/pkg-y' }));
  const emptyBaseline = { version: 1, files: {}, other: [] };

  const expect = (name, violations, predicate) => {
    const hit = violations.find(predicate);
    cases.push({ name, pass: Boolean(hit), detail: hit ? hit.message : '未捕获预期违规' });
    return hit;
  };
  const expectSilent = (name, violations, key) => {
    const hit = violations.find((v) => v.key === key);
    cases.push({ name, pass: !hit, detail: hit ? `不应报：${hit.message}` : '' });
  };

  // 正例：干净夹具零违规
  let r = runChecks(tmp, policy, emptyBaseline, {});
  cases.push({ name: 'clean-fixture 零违规', pass: r.violations.length === 0, detail: r.violations.map((v) => v.message).join('; ') });

  // 反例 1：未登记模块目录
  write('packages/pkg-z/src/index.ts', 'z\n');
  r = runChecks(tmp, policy, emptyBaseline, {});
  expect('unregistered-module 报红', r.violations, (v) => v.check === 'registry' && v.key === 'unregistered:packages/pkg-z');
  fs.rmSync(path.join(tmp, 'packages/pkg-z'), { recursive: true, force: true });

  // 反例 2：Rust 依赖边未登记（mod-a → mod-b）
  write('crates/mod-a/Cargo.toml', '[dependencies]\nmod-b = { path = "../mod-b" }\n');
  r = runChecks(tmp, policy, emptyBaseline, {});
  expect('rust-edge 报红（mod-a → mod-b 未在 requires）', r.violations, (v) => v.check === 'rust-edge' && v.key === 'edge:mod-a->mod-b');
  write('crates/mod-a/Cargo.toml', '[package]\nname = "mod-a"\n');

  // 反例 3：TS 包级环 pkg-x → pkg-y → pkg-x（且 pkg-y → pkg-x 边未登记）
  write('packages/pkg-x/src/index.ts', "import '@fixture/pkg-y';\nexport const x = 1;\n");
  write('packages/pkg-y/src/index.ts', "import '@fixture/pkg-x';\nexport const y = 1;\n");
  r = runChecks(tmp, policy, emptyBaseline, {});
  expect('ts-cycle 报红', r.violations, (v) => v.check === 'ts-cycle');
  expect('ts-edge 报红（pkg-y → pkg-x 未在 requires）', r.violations, (v) => v.check === 'ts-edge' && v.key === 'tedge:pkg-y->pkg-x');
  write('packages/pkg-y/src/index.ts', "export const y = 1;\n");
  r = runChecks(tmp, policy, emptyBaseline, {});
  expectSilent('已登记的包级边不报（pkg-x → pkg-y）', r.violations, 'tedge:pkg-x->pkg-y');

  // 反例 4：新建文件超限（10 行 > 5 行）
  write('crates/mod-a/src/big.rs', 'x\n'.repeat(9));
  r = runChecks(tmp, policy, emptyBaseline, {});
  expect('file-size 新建超限报红', r.violations, (v) => v.check === 'file-size' && v.key === 'over:crates/mod-a/src/big.rs');

  // 正例 5：基线冻结后不报；增长后报
  const frozen = { version: 1, files: { 'crates/mod-a/src/big.rs': 10 }, other: [] };
  r = runChecks(tmp, policy, frozen, {});
  expectSilent('基线冻结内不报', r.violations, 'growth:crates/mod-a/src/big.rs');
  write('crates/mod-a/src/big.rs', 'x\n'.repeat(12));
  r = runChecks(tmp, policy, frozen, {});
  expect('存量增长报红', r.violations, (v) => v.check === 'file-size' && v.key === 'growth:crates/mod-a/src/big.rs');

  // 正例 6：--changed 过滤（未变更的超限文件不报）
  r = runChecks(tmp, policy, emptyBaseline, { changedSet: new Set(['crates/mod-a/src/other.rs']) });
  expectSilent('--changed 过滤未变更文件', r.violations, 'over:crates/mod-a/src/big.rs');

  fs.rmSync(tmp, { recursive: true, force: true });

  let failed = 0;
  for (const c of cases) {
    console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.pass ? '' : `  —— ${c.detail}`}`);
    if (!c.pass) failed += 1;
  }
  console.log(`— self-test：${cases.length - failed}/${cases.length} 通过`);
  return failed === 0 ? 0 : 1;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) process.exit(selfTest());

  const root = DEFAULT_ROOT;
  const policyPath = path.join(root, POLICY_NAME);
  const baselinePath = path.join(root, BASELINE_NAME);
  if (!fs.existsSync(policyPath)) {
    console.error(`缺少策略文件：${POLICY_NAME}`);
    process.exit(2);
  }
  const policy = loadJson(policyPath);
  const baseline = fs.existsSync(baselinePath) ? loadJson(baselinePath) : { version: 1, files: {}, other: [] };
  const updateBaseline = args.includes('--update-baseline');
  const changed = args.includes('--changed');

  let changedSet = null;
  if (changed) {
    try {
      changedSet = getChangedSet(root);
    } catch (e) {
      console.error(`--changed 需要 git 环境：${e.message}`);
      process.exit(2);
    }
  }

  const usingBaseline = !updateBaseline && fs.existsSync(baselinePath);
  const { violations, overLimit } = runChecks(root, policy, baseline, { changedSet, ignoreBaseline: !usingBaseline });

  if (updateBaseline) {
    // 存量豁免只登记「非文件规模」类（文件规模由 files 冻结承担），避免基线自我重复
    const snapshotBaseline = { version: 1, files: overLimit, other: [] };
    const { violations: otherViolations } = runChecks(root, policy, snapshotBaseline, {});
    const next = {
      version: 1,
      updatedAt: new Date().toISOString().slice(0, 10),
      note: '存量基线（P4）：files = 超限文件行数冻结（只禁增长）；other = 存量违规豁免（新增违例不在内）',
      files: overLimit,
      other: otherViolations.map((v) => ({ check: v.check, key: v.key, note: v.message })),
    };
    fs.writeFileSync(baselinePath, JSON.stringify(next, null, 2) + '\n', 'utf8');
    console.log(`已生成 ${BASELINE_NAME}：冻结文件 ${Object.keys(next.files).length} 个 · 既有违规豁免 ${next.other.length} 项`);
    for (const o of next.other) console.log(`  · [${o.check}] ${o.note}`);
    process.exit(0);
  }

  const code = report(`root=${posix(path.relative(process.cwd(), root)) || '.'}`, violations, overLimit, changed ? 'changed' : 'full', changed ? undefined : Object.keys(baseline.files ?? {}).length);
  process.exit(code);
}

main();
