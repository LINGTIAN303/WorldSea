/**
 * dsh-plugin-worldsea — WorldSea 产品域工具集（D2，2026-09-28；内置级 cordis 插件）。
 *
 * 角色：让 Agent 以**原生工具**（与 fs/terminal 同级）直接读写工作台创作数据。
 * 执行体 = 直接读写 `worlddata/` 透明 JSON（与工作台 FileStorageBackend 同真相源）；
 * 外部写入经工作台 FsWatcher 天然刷新 UI（自身写入静默期不覆盖外部路径）——无需任何通知通道。
 *
 * 口径（D2 批计划 §1.1）：**项目 = dsh 工作区**——工具的实体目录 = 会话 cwd 下的 `worlddata/`
 * （cwd 来自 `exec.agent.session.header.cwd`，与会话的 workspace 对齐）。
 *
 * 依赖策略：**工具对象仍按 ToolDefinition 形状手写**（对齐 dsh-plugin-community 先例；register
 * 校验 output {schema, render} 子集，参数校验在 execute 内自查），不需要 import 任何 cordis 包。
 * **唯一第三方 import = `@deepseek-ai/schemastery`**（D3-c2，2026-09-30）——插件配置要有 schema
 * 才能被 dsh 设置面编辑（见下方 `Config`）。该包在 `package.json` 里**显式声明**为
 * `link:../../dsh/vendor/schemastery`，故 workspace 安装后 `apps/dsh-plugin-worldsea/node_modules/
 * @deepseek-ai/schemastery` 是真符号链接、解析无碍（原「零 import」策略针对的是**未声明依赖**
 * 时 @deepseek-ai scope 从 link: 目录解析不到的老问题）。代价：插件运行前 dsh 树须已构建
 * （vendor 的 `lib/` 是构建产物；缺失则 import 直接 fail loud）。
 *
 * 配置（**2026-10-07 预设化**：本插件挪进「产品域模式」预设（见 cordis.patch.yml），不再是顶层
 * 装载行——设置面编辑不到自身 config，数据面真源移到 console 插件经服务桥 `worldseaDataFace` 提供。
 * 取值链 = **console 服务（设置面「WorldSea 插件」Tab 编辑，保存即生效）> 自身 config（预设子行
 * 覆盖 / 单独部署兜底，schema 见下方 `Config`）**；dshHome 再回落 `process.env.DSH_HOME`）：
 * - `dshHome`：DSH_HOME 覆盖（最终缺省读 `process.env.DSH_HOME`）
 * - `dataRoot`：无会话 cwd 时的实体目录兜底（缺省无——非会话调用直接拒，fail loud）
 *
 * schema 快照：`<worlddata>/.worldsea/schema-snapshot.json`（工作台启动/重播种时导出），
 * put/update 用它做「类型存在 + 必填字段」轻校验。快照缺失时写操作拒（提示先开一次工作台）。
 *
 * 已知边界（D2 工具集第二轮登记，2026-09-28）：
 * - relation 并发：插件侧写经 `.worldsea/relations.lock` 互斥（mkdir 原子性 + holder.pid
 *   进程探活区分活锁/死锁：活持有→等满 8s fail loud，死残留→立即接管；60s 硬过期兜底）
 *   + 临时文件原子替换（防并行工具调用互覆与半截读）。工作台（webview）侧写不走此锁
 *   ——跨端同时写的窄窗口为已知边界（低频：需用户恰在界面编辑关系时 Agent 也在写关系），
 *   不做跨进程协同。
 * - schema 快照时效：bootstrapShell 启动/重播种时导出的静态副本；会话中途 schema 变更
 *   （schema = 代码内置注册表，低频）不推送——world_schema_get 返回附
 *   snapshotGeneratedAt 供 Agent 感知时效；schema 可编辑化时再升级为版本号方案。
 */

/** 稳定 cordis 插件名（内置插件页显示的包标识）。 */
const name = 'worldsea';

/** 前置服务：工具注册面 + system prompt 指引段（缺失即 `cannot get property ... without inject`）。 */
const inject = ['tools', 'systemPrompt'];

//#region ── 通用工具函数 ────────────────────────────────────────────────

/** POSIX 化路径分隔符（Windows 兼容拼接）。 */
const join = (...parts) =>
  parts.filter(Boolean).join('/').replace(/\\/g, '/').replace(/(?<=^[A-Za-z]:\/)\/+/, '/');

/** JSON 文件读取（缺失/损坏 → null，由调用方决定兜底）。 */
function readJson(path) {
  try {
    return JSON.parse(fsRead(path));
  } catch {
    return null;
  }
}

/** node:fs 惰性静态绑定（ESM 顶层 import 也无妨——除 schemastery 外不引第三方包）。 */
import { readFileSync as fsRead, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, rmSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import z from '@deepseek-ai/schemastery';

/**
 * 插件配置 schema（cordis `Config` 约定）。
 *
 * **为什么必须有它**：dsh 设置面的写入门槛要求条目既有 schema、又含 volatile 字段
 * （`dsh/packages/settings/settings/src/index.ts:383-385` 分别抛 `No configurable plugin entry`
 * 与 `has no volatile fields`）——没有它，本插件的配置就只能读不能编辑。
 *
 * 两字段都 `volatile()`：插件是**每次调用现读 config**（见下方 dshHome / worlddataDir），
 * 改值无需重挂载。缺省 `''` = 未设 → 既有回落链（env / fail loud）原样生效。
 * 编辑入口 = 设置 → 内置插件 → 「WorldSea 插件」Tab 的 worldsea 卡片——但绑定的是 console
 * 插件的命名空间（本插件预设化后自身 config 不在设置面上，此 schema 服务于单独部署兜底 +
 * 保持 volatile 物化句柄的实测契约用例）。
 */
export const Config = z.object({
  /** DSH_HOME 覆盖（缺省读 `process.env.DSH_HOME`）。 */
  dshHome: z.string().default('').volatile(),
  /** 无会话 cwd 时的实体目录兜底（缺省无——非会话调用直接拒，fail loud）。 */
  dataRoot: z.string().default('').volatile(),
});

/** 写 JSON（自动建父目录）。 */
function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

/** 原子写 JSON：临时文件 + 同卷 rename 覆盖（临时文件与目标同目录保证同卷），读者不会读到半截文件。 */
function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2));
    renameSync(tmp, path);
  } catch (error) {
    try { unlinkSync(tmp); } catch { /* 清理失败不掩盖主错误 */ }
    throw error;
  }
}

/** 会话工作区 cwd（与 tool-fs 的 session-cwd 同源口径）。 */
function sessionCwd(exec) {
  return exec?.agent?.session?.header?.cwd;
}

/** 实体数据根 = 会话 cwd/worlddata；无会话 cwd 且未配置兜底 → fail loud。 */
function worlddataDir(exec, config) {
  const cwd = sessionCwd(exec);
  if (cwd) return join(cwd, 'worlddata');
  const fallback = configText(config?.dataRoot);
  if (fallback) return join(fallback, 'worlddata');
  throw new Error('WORLDSEA_NO_SESSION: 本工具需要会话工作区上下文（cwd）——请从会话内调用，或在插件 config.dataRoot 配置兜底目录');
}

/**
 * 取一次配置字段的当前值。
 *
 * **为什么需要它**：本插件声明了 `Config` schema 且两字段标了 `volatile()`——物化后这类字段**不是原值**，
 * 而是 cosmokit 的 `Volatile<T>` 稳定引用（`{ get(): 快照 }`，见 `vendor/cosmokit/src/volatile.ts`：*keep the
 * reference, or capture its value for one operation only*）。**加 schema 之前** cordis 传的是 patch 行里的原值，
 * 故旧写法 `config.dshHome || env` 会把这个恒真句柄当路径用（`String(句柄)` = `[object Object]`）——实测踩到。
 * 普通（非 volatile）字段仍是原值，故统一走本函数。判据与 cosmokit `isVolatile` 等价；不引 cosmokit 只为
 * 一个谓词多挂一条 link 依赖，代价是若上游改判定需靠 `__tests__/config.spec.ts` 的物化链用例报警。
 */
function configText(value) {
  return value !== null && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value;
}

/**
 * 读 console 服务桥（worldseaDataFace）的一个数据面现值。
 *
 * 软访问（不进 inject）：console 是顶层 bundle 插件，正常装配下必然先于本预设子实例激活；
 * 但本插件允许脱离 console 单独部署（此时回落自身 config / env）——硬 inject 会把两插件
 * 焊死成装载依赖，与「分开变化节奏」的分治初衷相悖。服务未就绪/字段未设置 → null。
 */
function faceValue(ctx, field) {
  // cordis 对**未 inject** 的服务属性访问直接抛错（`cannot get property ... without inject`——
  // console 未挂载或会话未注入服务桥时触发，2026-10-13 走查实测挂在写工具的 requireWorkspaceRoot 链上）。
  // 软访问语义 = 拿不到就回落自身 config / env，故属性读取兜 try/catch 归 null。
  let face;
  try {
    face = ctx?.worldseaDataFace;
  } catch {
    return null;
  }
  const value = typeof face?.[field] === 'function' ? face[field]() : null;
  return value === null || value === undefined ? null : String(value);
}

/** DSH_HOME（与壳的 spawn 口径同源）：生效视图.dshHome（console 服务 > 自身 config）> process.env.DSH_HOME。 */
function dshHome(config) {
  return configText(config?.dshHome) || process.env.DSH_HOME || null;
}

/** 文件名消毒：替换路径非法字符（id 已保证唯一性，文件名差异不影响按内容寻 id 的读取）。 */
function safeFileName(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_');
}

/** 目录下全部 *.json 的解析结果（跳过损坏与 _index 等下划线文件）。 */
function readJsonDir(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json') || file.startsWith('_')) continue;
    const value = readJson(`${dir}/${file}`);
    if (value && typeof value === 'object') out.push({ file: `${dir}/${file}`, value });
  }
  return out;
}

/** 按 id 在实体/关系目录中定位文件（读内容比对 id——文件名不作寻址依据）。 */
function findFileById(dir, id) {
  for (const entry of readJsonDir(dir)) {
    if (entry.value?.id === id) return entry;
  }
  for (const sub of readdirSafe(dir)) {
    const hit = findFileById(sub, id);
    if (hit) return hit;
  }
  return null;
}

/** 按点路径挑字段（world_entity_get 的 fields 参数）：id/type 恒返回；路径不存在 → 该键省略（省载荷）。 */
function pickFields(entity, fields) {
  // 入参两态：字符串按逗号拆（LLM 调用方常见笔误，容忍空段）；数组逐项必须为非空字符串
  let paths;
  if (typeof fields === 'string') {
    paths = fields.split(',').map((f) => f.trim()).filter(Boolean);
  } else if (Array.isArray(fields)) {
    if (!fields.length || fields.some((f) => typeof f !== 'string' || !f.trim())) {
      throw new Error('WORLDSEA_BAD_ARGS: fields 必须是非空字符串数组（点路径，如 ["properties.age"]）');
    }
    paths = fields.map((f) => f.trim());
  } else {
    throw new Error('WORLDSEA_BAD_ARGS: fields 必须是非空字符串数组（点路径，如 ["properties.age"]）');
  }
  if (!paths.length) throw new Error('WORLDSEA_BAD_ARGS: fields 不能为空（点路径，如 ["properties.age"]）');
  const out = { id: entity.id, type: entity.type };
  for (const path of paths) {
    const keys = path.split('.');
    let node = entity;
    for (const key of keys) {
      if (node == null || typeof node !== 'object' || !(key in node)) { node = undefined; break; }
      node = node[key];
    }
    if (node === undefined) continue;
    let cursor = out;
    for (let i = 0; i < keys.length - 1; i++) {
      if (cursor[keys[i]] == null || typeof cursor[keys[i]] !== 'object') cursor[keys[i]] = {};
      cursor = cursor[keys[i]];
    }
    cursor[keys[keys.length - 1]] = node;
  }
  return out;
}

/** 清单分页缺省上限（大项目保护：千级实体时避免一次性下载荷）。 */
const DEFAULT_PAGE_LIMIT = 200;

/** 分页参数整型化：limit 非法/缺省 → DEFAULT_PAGE_LIMIT（最小 1）；offset 非法 → 0（宽容字符串数字）。 */
function pageArgs(args) {
  const rawLimit = Number(args?.limit);
  const rawOffset = Number(args?.offset);
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.floor(rawLimit) : DEFAULT_PAGE_LIMIT;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;
  return { limit, offset };
}

/** 清单排序契约：updatedAt 降序（新者在前）→ id 升序兜底——分页跨页不重不漏的确定性基准。 */
const byRecency = (a, b) =>
  String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')) || String(a.id).localeCompare(String(b.id));

//#endregion

//#region ── 数据访问：项目 / schema 快照 / 实体 ─────────────────────────

/** dsh 工作区列表（与壳 cmd_dsh_workspace_list 同源：直读 storages/workspace.json）。 */
function readDshWorkspaces(config) {
  const home = dshHome(config);
  if (!home) throw new Error('WORLDSEA_NO_DSH_HOME: 找不到 DSH_HOME（env 未设且插件 config.dshHome 未配）');
  const value = readJson(`${home}/storages/workspace.json`);
  if (!value) return [];
  const order = value?.global?.workspaceIds ?? [];
  const tables = value?.tables?.workspaces ?? {};
  const items = [];
  for (const id of order) {
    const entry = tables[id];
    if (entry?.title && entry?.path) items.push({ id, title: entry.title, path: entry.path });
  }
  return items;
}

/** schema 快照路径。 */
const schemaSnapshotPath = (wd) => `${wd}/.worldsea/schema-snapshot.json`;

/** 读 schema 快照（缺失 → 抛可读错误）。 */
function readSchemaSnapshot(wd) {
  const snapshot = readJson(schemaSnapshotPath(wd));
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('WORLDSEA_NO_SCHEMA_SNAPSHOT: schema 快照不存在——请先打开一次工作台（工作台启动时自动导出 worlddata/.worldsea/schema-snapshot.json）');
  }
  return snapshot;
}

/** 单类型 schema（快照形状：{ generatedAt, types: { <typeKey>: { typeKey, label, required[], properties{} } } }）。 */
function schemaOf(snapshot, type) {
  const schema = snapshot.types?.[type];
  if (!schema) {
    const known = Object.keys(snapshot.types ?? {}).join('、');
    throw new Error(`WORLDSEA_TYPE_UNKNOWN: 未登记的实体类型 ${type}（已登记：${known || '无'}）`);
  }
  return schema;
}

/** 实体目录。 */
const entitiesDir = (wd) => `${wd}/entities`;
/** 单类型实体目录。 */
const entitiesTypeDir = (wd, type) => `${entitiesDir(wd)}/${type}`;

/** 关系真相源 = `relations/_index.json`（全量清单，FileStorageBackend.loadRelations 同源）。 */
const relationsIndexPath = (wd) => `${wd}/relations/_index.json`;
/** 读全量关系（缺失 → 空数组）。 */
function readRelations(wd) {
  const list = readJson(relationsIndexPath(wd));
  return Array.isArray(list) ? list : [];
}
/** 写全量关系（原子替换；工作台 watcher 对 _index.json 判 relationsChanged → 缓存失效重载）。 */
function writeRelations(wd, list) {
  writeJsonAtomic(relationsIndexPath(wd), list);
}

/** 关系互斥锁目录（mkdirSync 的原子性充当互斥；位于 watcher 忽略的 .worldsea/ 内，不抖 UI）。 */
const relationsLockPath = (wd) => `${wd}/.worldsea/relations.lock`;
/** 锁等待上限（持有方活着就等它，超时 fail loud——绝不按「等满即抢」猜测）。 */
const RELATION_LOCK_TIMEOUT_MS = 8000;
/** 锁重试间隔。 */
const RELATION_LOCK_RETRY_MS = 25;
/** 锁硬过期线（兜 PID 复用等极端情形，保证残留锁最终必然可自愈）。 */
const RELATION_LOCK_MAX_AGE_MS = 60000;
/** 持有方 mkdir 后写 pid 文件的宽限（此窗口内空锁视为活的，防止抢走正在初始化的锁）。 */
const RELATION_LOCK_WRITE_GRACE_MS = 2000;
/** 锁目录内的持有方进程号文件名。 */
const LOCK_PID_FILE = 'holder.pid';

/**
 * 锁是否为崩溃残留（可安全接管）：持有方进程已死 / 锁超硬过期线 / 空锁超写入宽限。
 * 全部合法持有方（插件工具执行）与等待方同处宿主进程——「跨进程残留」只出现在宿主重启后，
 * 此时旧持有方 pid 必然已死，探活判定即可精确区分「活锁」与「死锁」。
 */
function isStaleRelationLock(lock) {
  let mtimeMs;
  try {
    mtimeMs = statSync(lock).mtimeMs;
  } catch {
    return true; // 锁目录已消失（刚被释放）→ 按残留走 rmSync(no-op) + 重试，等效「锁已可得」
  }
  if (Date.now() - mtimeMs > RELATION_LOCK_MAX_AGE_MS) return true;
  let pidRaw = null;
  try {
    pidRaw = fsRead(`${lock}/${LOCK_PID_FILE}`, 'utf8');
  } catch { /* pid 文件暂缺 → 走宽限分支（持有方可能刚 mkdir 尚未写入） */ }
  const holderPid = Number(pidRaw);
  if (Number.isInteger(holderPid) && holderPid > 0) {
    if (holderPid === process.pid) return false; // 本进程并行工具调用持有 → 活的，等
    try {
      process.kill(holderPid, 0); // 信号 0 = 仅探活，不投递
      return false;
    } catch (e) {
      return e.code === 'ESRCH'; // 确认不存在 → 残留；EPERM 等异常按活的处理（宁可多等）
    }
  }
  // 无 pid 文件：持有方可能刚 mkdir 尚未写入（宽限内当活的），或写前即崩（超宽限 = 残留）
  return Date.now() - mtimeMs > RELATION_LOCK_WRITE_GRACE_MS;
}

/**
 * 关系读-改-写的互斥执行（插件侧串行化，防并行工具调用互覆）。
 * 锁自愈：持有方进程已死的残留锁立即接管；持有方活着则等待，超时 fail loud。
 * @param mutate - 收当前全量关系，返回新全量（纯函数；落盘由本函数在锁内原子完成）。
 */
async function mutateRelations(wd, mutate) {
  const lock = relationsLockPath(wd);
  mkdirSync(dirname(lock), { recursive: true });
  const deadline = Date.now() + RELATION_LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      if (isStaleRelationLock(lock)) {
        rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error('WORLDSEA_RELATION_BUSY: 关系写互斥等待超时——另一个写入方正在持有锁，请稍后重试');
      }
      await new Promise((resolve) => setTimeout(resolve, RELATION_LOCK_RETRY_MS));
    }
  }
  try {
    writeFileSync(`${lock}/${LOCK_PID_FILE}`, String(process.pid), 'utf8');
    const next = mutate(readRelations(wd));
    writeRelations(wd, next);
    return next;
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** 路径归一化（workspace 匹配用）：统一分隔符/去尾/小写（Windows 不敏感）。 */
function normalizePath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** 空结果环境化：区分「数据目录未初始化」（worlddata 不存在 = 工作台从未打开过）与「已初始化但无数据」。 */
const emptyState = (wd) => (existsSync(wd) ? 'empty' : 'uninitialized');

/**
 * 写前工作区守卫（严格拒）：会话 cwd 必须正好是某个已登记 dsh 工作区的根目录——
 * 防止 cwd 配错时把 worlddata 误写进非项目目录（如代码仓库）；cwd 在某工作区内部但非根
 * 同样拒（创作数据以工作区根的 worlddata/ 为准）。config.dataRoot 兜底属显式配置不受此限
 * （无会话 cwd 时本就 fail loud，走不到这里）。只拦写操作，读操作不拦。
 */
function requireWorkspaceRoot(exec, config) {
  const cwd = sessionCwd(exec);
  if (!cwd) return;
  const norm = normalizePath(cwd);
  const workspaces = readDshWorkspaces(config);
  if (workspaces.some((w) => normalizePath(w.path) === norm)) return;
  const inside = workspaces.find((w) => norm.startsWith(`${normalizePath(w.path)}/`));
  if (inside) {
    throw new Error(`WORLDSEA_NOT_A_WORKSPACE: 会话 cwd 位于工作区「${inside.title}」内部但不是其根目录——创作数据以工作区根的 worlddata/ 为准，请从工作台打开的会话调用`);
  }
  throw new Error('WORLDSEA_NOT_A_WORKSPACE: 会话 cwd 不在任何已登记的 dsh 工作区内（写前守卫，防误写非项目目录）——请从工作台会话调用，或在插件 config.dataRoot 显式指定数据根');
}

/** 写实体（工作台同规则：entities/<type>/<名>_<id>.json；id 由调用方提供或此处生成）。 */
function putEntityFile(wd, entity) {
  const dir = entitiesTypeDir(wd, entity.type);
  mkdirSync(dir, { recursive: true });
  const path = `${dir}/${safeFileName(entity.name)}_${entity.id}.json`;
  writeJson(path, entity);
  return path;
}

//#endregion

//#region ── 工具定义（ToolDefinition 形状手写；参数校验在 execute 内自查）──

/** 输出 schema 通用片段：无结构化输出诉求的工具用宽松 object（render 返回紧凑 JSON 文本）。
 *  ★ parameters/output 必须是 **JSON Schema 形态**（register/装载管线按 JSON Schema 校验；
 *    defineTool 的简写规格转换在这里不可用——本插件零依赖手写）。 */
const looseOutput = {
  schema: { type: 'object', properties: {} },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
};

/** 清单类输出 schema：**output 校验强制 value 为 object**（数组 root 违规——
 *  2026-09-28 会话实测 `returned invalid output: "value" must be an object`），
 *  故清单统一包 `{ items: [...] }` 返回；空结果附 state（环境化，见 emptyState）。 */
const listOutput = {
  schema: {
    type: 'object',
    properties: { items: { type: 'array' }, state: { type: 'string', enum: ['uninitialized', 'empty'] } },
    required: ['items'],
  },
  render: (_args, value) => [
    { type: 'text', text: JSON.stringify(value.state ? { items: value.items, state: value.state } : (value.items ?? value), null, 2) },
  ],
};

/** 清单包对象（对应 listOutput）。 */
const asItems = (items) => ({ items });

/** 分页清单输出：items + total/offset/limit 回显（render 全量展示——Agent 需读 total 判断是否继续翻页）；
 *  空结果附 state（环境化，见 emptyState）。 */
const pagedListOutput = {
  schema: {
    type: 'object',
    properties: {
      items: { type: 'array' },
      total: { type: 'number' },
      offset: { type: 'number' },
      limit: { type: 'number' },
      state: { type: 'string', enum: ['uninitialized', 'empty'] },
    },
    required: ['items', 'total'],
  },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
};

/** 必填非空字符串参数自查。 */
function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`WORLDSEA_BAD_ARGS: ${field} 必填（非空字符串）`);
  return value;
}

/** 外部插件 id 自查：ws. 前缀 + 点分段（与工作台 manifest 的 ID_RE 同形；内置 official.* 域不可冒名）。 */
function requirePluginId(value) {
  const id = requireString(value, 'id');
  if (!/^ws(\.[a-z0-9_-]+)+$/.test(id)) {
    throw new Error(`WORLDSEA_PLUGIN_ID_INVALID: 插件 id 须为 ws. 开头的小写点分形式（如 ws.counter），收到「${id}」`);
  }
  return id;
}

/** 外部插件最小模板（world_plugin_template 的返回体；管理界面空态提示同源口径）。 */
const PLUGIN_TEMPLATE = [
  '(require) => ({',
  '  manifest: {',
  "    id: 'ws.counter',",
  "    name: '实体计数',",
  "    version: '0.1.0',",
  "    description: '示例插件：侧栏视图显示当前项目实体数量',",
  '  },',
  '  apply(ctx, api) {',
  "    const { h, ref, onMounted } = require('vue');",
  "    const { useEntityStore } = require('@worldsea/entity-core');",
  '    const MyView = {',
  '      setup() {',
  '        const count = ref(0);',
  '        onMounted(async () => {',
  '          try { await useEntityStore().loadAll(); } catch {}',
  '          count.value = Object.keys(useEntityStore().entities ?? {}).length;',
  '        });',
  "        return () => h('div', { style: 'padding:16px' }, [",
  "          h('h3', '实体计数'),",
  "          h('p', `当前项目共 ${count.value} 个实体`),",
  '        ]);',
  '      },',
  '    };',
  "    api.registerView({ id: 'counter', label: '实体计数', icon: 'puzzle', component: MyView });",
  '  },',
  '})',
].join('\n');

const tools = [
  {
    name: 'world_project_list',
    description: '列出 WorldSea 的项目（项目 = dsh 工作区目录，同源模型）：id / 名称 / 目录 path。当前项目的创作数据 = 会话 cwd 下的 worlddata/。',
    parameters: { type: 'object', properties: {}, required: [] },
    output: listOutput,
    async execute(_args, exec) {
      return asItems(readDshWorkspaces(exec?.pluginConfig ?? {}));
    },
  },
  {
    name: 'world_project_current',
    description: '当前项目：会话工作区（cwd）对齐到的 dsh 工作区（id/title/path）；cwd 不在任何工作区时 id 为 null。',
    parameters: { type: 'object', properties: {}, required: [] },
    output: looseOutput,
    async execute(_args, exec) {
      const cwd = sessionCwd(exec);
      if (!cwd) throw new Error('WORLDSEA_NO_SESSION: 本工具需要会话工作区上下文（cwd）');
      const norm = normalizePath(cwd);
      const hit = readDshWorkspaces(exec?.pluginConfig ?? {}).find((w) => normalizePath(w.path) === norm);
      return hit ? { id: hit.id, title: hit.title, path: hit.path } : { id: null, title: null, path: cwd };
    },
  },
  {
    name: 'world_schema_get',
    description: '读 WorldSea 实体类型的字段 schema（typeKey/label/必填字段）。组装实体数据前先取它；type 省略 = 全部类型。单类型返回附 snapshotGeneratedAt（快照为工作台启动时导出，可据此感知时效）。',
    parameters: {
      type: 'object',
      properties: { type: { type: 'string', description: '实体类型 typeKey（如 character）；省略 = 全部' } },
      required: [],
    },
    output: looseOutput,
    async execute(args, exec) {
      const wd = worlddataDir(exec, exec?.pluginConfig ?? {});
      const snapshot = readSchemaSnapshot(wd);
      if (args?.type) {
        const schema = schemaOf(snapshot, requireString(args.type, 'type'));
        return { ...schema, snapshotGeneratedAt: snapshot.generatedAt ?? null };
      }
      return snapshot;
    },
  },
  {
    name: 'world_entity_list',
    description: '列出 WorldSea 创作数据里的实体（瘦身：id/type/name）。返回 {items,total,offset,limit}——total 超过 items 长度说明有更多，用 offset 翻页；空结果附 state（uninitialized=数据目录未初始化，empty=暂无数据）；字段详情用 world_entity_get。',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: '按实体类型过滤（typeKey）；省略 = 全部' },
        limit: { type: 'number', description: '单页条数上限（缺省 200）' },
        offset: { type: 'number', description: '起始偏移（配合 limit 翻页；缺省 0）' },
      },
      required: [],
    },
    output: pagedListOutput,
    async execute(args, exec) {
      const wd = worlddataDir(exec, exec?.pluginConfig ?? {});
      const type = args?.type ? requireString(args.type, 'type') : null;
      const dirs = type ? [entitiesTypeDir(wd, type)] : readdirSafe(entitiesDir(wd));
      const out = [];
      for (const dir of dirs) {
        for (const entry of readJsonDir(dir)) {
          if (entry.value?.id && entry.value?.type) {
            out.push({ id: entry.value.id, type: entry.value.type, name: entry.value.name, updatedAt: entry.value.updatedAt });
          }
        }
      }
      out.sort(byRecency);
      const { limit, offset } = pageArgs(args);
      const items = out.slice(offset, offset + limit).map(({ id, type: entityType, name }) => ({ id, type: entityType, name }));
      const result = { items, total: out.length, offset, limit };
      if (!items.length) result.state = emptyState(wd);
      return result;
    },
  },
  {
    name: 'world_entity_search',
    description: '按关键词搜 WorldSea 实体（匹配 name 与 description，大小写不敏感；可选 tag 标签过滤）。返回 {items,total,offset,limit} 分页（排序 = updatedAt 降序→id 升序）；空结果附 state（uninitialized=数据目录未初始化，empty=暂无数据）。不确定类型/名称时先用它定位。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词（名称/描述模糊匹配）' },
        type: { type: 'string', description: '限定实体类型（typeKey）；省略 = 全部' },
        tag: { type: 'string', description: '按标签过滤（实体 tags 含该值）；省略 = 不过滤' },
        limit: { type: 'number', description: '单页条数上限（缺省 200）' },
        offset: { type: 'number', description: '起始偏移（配合 limit 翻页；缺省 0）' },
      },
      required: ['query'],
    },
    output: pagedListOutput,
    async execute(args, exec) {
      const wd = worlddataDir(exec, exec?.pluginConfig ?? {});
      const query = requireString(args?.query, 'query').toLowerCase();
      const type = args?.type ? requireString(args.type, 'type') : null;
      const tag = args?.tag ? requireString(args.tag, 'tag') : null;
      const dirs = type ? [entitiesTypeDir(wd, type)] : readdirSafe(entitiesDir(wd));
      const out = [];
      for (const dir of dirs) {
        for (const entry of readJsonDir(dir)) {
          const v = entry.value;
          if (!v?.id || !v?.type) continue;
          if (tag && !(Array.isArray(v.tags) && v.tags.includes(tag))) continue;
          const haystack = `${v.name ?? ''}\n${v.description ?? ''}`.toLowerCase();
          if (haystack.includes(query)) out.push({ id: v.id, type: v.type, name: v.name, updatedAt: v.updatedAt });
        }
      }
      out.sort(byRecency);
      const { limit, offset } = pageArgs(args);
      const items = out.slice(offset, offset + limit).map(({ id, type: entityType, name }) => ({ id, type: entityType, name }));
      const result = { items, total: out.length, offset, limit };
      if (!items.length) result.state = emptyState(wd);
      return result;
    },
  },
  {
    name: 'world_entity_get',
    description: '读取 WorldSea 实体数据（省略 fields = 完整数据含 properties）。fields 可选：点路径数组（如 ["name","properties.age"]）按需取字段减载荷；id/type 恒返回，不存在的路径省略。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '实体 id' },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: '要取的字段（点路径，支持 properties.xxx）；省略 = 完整实体',
        },
      },
      required: ['id'],
    },
    output: looseOutput,
    async execute(args, exec) {
      const wd = worlddataDir(exec, exec?.pluginConfig ?? {});
      const id = requireString(args?.id, 'id');
      const hit = findFileById(entitiesDir(wd), id);
      if (!hit) throw new Error(`WORLDSEA_ENTITY_UNKNOWN: 实体不存在（${id}）`);
      return args?.fields !== undefined ? pickFields(hit.value, args.fields) : hit.value;
    },
  },
  {
    name: 'world_entity_put',
    description: '在 WorldSea 新建实体（写创作数据）。先 world_schema_get 拿该类型 schema，再按 required 字段组装 properties。写后工作台界面自动刷新。',
    parameters: {
      type: 'object',
      properties: {
        entity: { type: 'object', description: '{type, name, description?, properties?, tags?}；id 省略自动生成' },
      },
      required: ['entity'],
    },
    output: looseOutput,
    async execute(args, exec) {
      const config = exec?.pluginConfig ?? {};
      const wd = worlddataDir(exec, config);
      requireWorkspaceRoot(exec, config);
      const raw = args?.entity;
      if (!raw || typeof raw !== 'object') throw new Error('WORLDSEA_BAD_ARGS: entity 必须是对象');
      const type = requireString(raw.type, 'entity.type');
      const name = requireString(raw.name, 'entity.name');
      // schema 快照轻校验：类型存在 + required 字段齐（在 properties 或实体级字段上）
      const snapshot = readSchemaSnapshot(wd);
      const schema = schemaOf(snapshot, type);
      const props = raw.properties && typeof raw.properties === 'object' ? raw.properties : {};
      for (const field of schema.required ?? []) {
        const provided = props[field] !== undefined && props[field] !== ''
          || raw[field] !== undefined && raw[field] !== '';
        if (!provided) throw new Error(`WORLDSEA_REQUIRED_MISSING: 类型 ${type} 的必填字段「${field}」缺失（见 world_schema_get）`);
      }
      const now = new Date().toISOString();
      const entity = {
        id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : crypto.randomUUID(),
        type,
        name,
        description: typeof raw.description === 'string' ? raw.description : '',
        properties: props,
        tags: Array.isArray(raw.tags) ? raw.tags : [],
        createdAt: now,
        updatedAt: now,
      };
      const path = putEntityFile(wd, entity);
      return { id: entity.id, type: entity.type, name: entity.name, path };
    },
  },
  {
    name: 'world_entity_update',
    description: '按 id 局部更新 WorldSea 实体（changes 只传要改的字段）。changes.properties 缺省整包替换；mergeProperties=true 时与既有 properties 按字段合并（只改动点名的字段，其余保留）。写后工作台界面自动刷新。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '实体 id' },
        changes: { type: 'object', description: '要改的字段（name/description/properties/tags…）' },
        mergeProperties: { type: 'boolean', description: 'true = properties 按字段合并（缺省 false = 整包替换）' },
      },
      required: ['id', 'changes'],
    },
    output: looseOutput,
    async execute(args, exec) {
      const config = exec?.pluginConfig ?? {};
      const wd = worlddataDir(exec, config);
      requireWorkspaceRoot(exec, config);
      const id = requireString(args?.id, 'id');
      if (!args?.changes || typeof args.changes !== 'object') throw new Error('WORLDSEA_BAD_ARGS: changes 必须是对象');
      const hit = findFileById(entitiesDir(wd), id);
      if (!hit) throw new Error(`WORLDSEA_ENTITY_UNKNOWN: 实体不存在（${id}）`);
      // mergeProperties=true：properties 与既有值按字段合并（只改动点名字段）；缺省整包替换
      let properties = args.changes.properties;
      if (args.mergeProperties === true && properties && typeof properties === 'object') {
        properties = {
          ...(hit.value.properties && typeof hit.value.properties === 'object' ? hit.value.properties : {}),
          ...properties,
        };
      }
      const updated = {
        ...hit.value,
        ...args.changes,
        ...(properties !== undefined ? { properties } : {}),
        id: hit.value.id,
        type: hit.value.type,
        updatedAt: new Date().toISOString(),
      };
      writeJson(hit.file, updated);
      return { id, name: updated.name };
    },
  },
  {
    name: 'world_entity_delete',
    description: '按 id 删除 WorldSea 实体（不可恢复，谨慎）。同时清理指向/来自该实体的关系（对齐工作台原子删除语义）。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: '实体 id' } },
      required: ['id'],
    },
    output: looseOutput,
    async execute(args, exec) {
      const config = exec?.pluginConfig ?? {};
      const wd = worlddataDir(exec, config);
      requireWorkspaceRoot(exec, config);
      const id = requireString(args?.id, 'id');
      const hit = findFileById(entitiesDir(wd), id);
      if (!hit) throw new Error(`WORLDSEA_ENTITY_UNKNOWN: 实体不存在（${id}）`);
      // 关联清理（对齐 FileStorageBackend.deleteEntityAtomic）：先摘关系再删实体（互斥 + 原子替换）
      const relations = readRelations(wd);
      const relationsRemoved = relations.filter((r) => r?.sourceId === id || r?.targetId === id).length;
      if (relationsRemoved > 0) {
        await mutateRelations(wd, (list) => list.filter((r) => r?.sourceId !== id && r?.targetId !== id));
      }
      unlinkSync(hit.file);
      return { id, relationsRemoved };
    },
  },
  {
    name: 'world_relation_list',
    description: '列出 WorldSea 实体间的关系（瘦身默认形状：id/type/sourceId/targetId/label；properties 等按需用 fields 点路径取）。entityId = 与该实体相关；type = 关系类型过滤；返回 {items,total,offset,limit} 分页（排序 = updatedAt 降序→id 升序）；空结果附 state。',
    parameters: {
      type: 'object',
      properties: {
        entityId: { type: 'string', description: '按实体过滤（source 或 target）' },
        type: { type: 'string', description: '按关系类型过滤（typeKey）' },
        fields: { type: 'array', items: { type: 'string' }, description: '按条取字段（点路径，如 ["properties.weight"]）；省略 = 瘦身默认形状' },
        limit: { type: 'number', description: '单页条数上限（缺省 200）' },
        offset: { type: 'number', description: '起始偏移（配合 limit 翻页；缺省 0）' },
      },
    },
    output: pagedListOutput,
    async execute(args, exec) {
      const wd = worlddataDir(exec, exec?.pluginConfig ?? {});
      const all = readRelations(wd);
      const entityId = args?.entityId ? requireString(args.entityId, 'entityId') : null;
      const relationType = args?.type ? requireString(args.type, 'type') : null;
      const filtered = all.filter((r) => {
        if (!r?.id) return false;
        if (entityId && r.sourceId !== entityId && r.targetId !== entityId) return false;
        if (relationType && r.type !== relationType) return false;
        return true;
      });
      filtered.sort(byRecency);
      const { limit, offset } = pageArgs(args);
      const sliced = filtered.slice(offset, offset + limit);
      const items = args?.fields !== undefined
        ? sliced.map((r) => pickFields(r, args.fields))
        : sliced.map((r) => ({ id: r.id, type: r.type, sourceId: r.sourceId, targetId: r.targetId, label: r.label }));
      const result = { items, total: filtered.length, offset, limit };
      if (!items.length) result.state = emptyState(wd);
      return result;
    },
  },
  {
    name: 'world_relation_put',
    description: '在 WorldSea 新建实体间关系（sourceId/targetId = 实体 id，两端必须已存在）。写后工作台界面自动刷新。',
    parameters: {
      type: 'object',
      properties: {
        relation: { type: 'object', description: '{type, sourceId, targetId, label?, properties?}；id 与时间戳自动生成' },
      },
      required: ['relation'],
    },
    output: looseOutput,
    async execute(args, exec) {
      const config = exec?.pluginConfig ?? {};
      const wd = worlddataDir(exec, config);
      requireWorkspaceRoot(exec, config);
      const raw = args?.relation;
      if (!raw || typeof raw !== 'object') throw new Error('WORLDSEA_BAD_ARGS: relation 必须是对象');
      const type = requireString(raw.type, 'relation.type');
      const sourceId = requireString(raw.sourceId, 'relation.sourceId');
      const targetId = requireString(raw.targetId, 'relation.targetId');
      // 两端实体必须存在（防悬挂关系）
      for (const [field, entityId] of [['sourceId', sourceId], ['targetId', targetId]]) {
        if (!findFileById(entitiesDir(wd), entityId)) {
          throw new Error(`WORLDSEA_ENTITY_UNKNOWN: relation.${field} 指向的实体不存在（${entityId}）`);
        }
      }
      const now = new Date().toISOString();
      const relation = {
        id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : crypto.randomUUID(),
        type,
        sourceId,
        targetId,
        label: typeof raw.label === 'string' ? raw.label : undefined,
        properties: raw.properties && typeof raw.properties === 'object' ? raw.properties : {},
        createdAt: now,
        updatedAt: now,
      };
      await mutateRelations(wd, (list) => {
        const idx = list.findIndex((r) => r?.id === relation.id);
        if (idx >= 0) list[idx] = relation;
        else list.push(relation);
        return list;
      });
      return { id: relation.id, type: relation.type };
    },
  },
  {
    name: 'world_relation_delete',
    description: '按 id 删除 WorldSea 关系。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: '关系 id' } },
      required: ['id'],
    },
    output: looseOutput,
    async execute(args, exec) {
      const config = exec?.pluginConfig ?? {};
      const wd = worlddataDir(exec, config);
      requireWorkspaceRoot(exec, config);
      const id = requireString(args?.id, 'id');
      if (!readRelations(wd).some((r) => r?.id === id)) {
        throw new Error(`WORLDSEA_RELATION_UNKNOWN: 关系不存在（${id}）`);
      }
      await mutateRelations(wd, (list) => list.filter((r) => r?.id !== id));
      return { id };
    },
  },

  /* ─── 外部插件管理（批1，2026-10-13）：worlddata/.worldsea/plugins/<id>.js ───
   * 文件 = 箭头函数表达式 `(require) => ({ manifest, apply })`；写入后工作台 ~1s 自动热装载
   * （FsWatcher → 世界树重对账）。id 强制 ws. 前缀（内置 official.* 不可冒名）。 */

  {
    name: 'world_plugin_list',
    description: '列出 WorldSea 当前项目的世界树外部插件（worlddata/.worldsea/plugins/ 下的 <id>.js 文件）：id / 大小 / 修改时间。装载状态与被拒原因在工作台「设置 → 插件」里看。',
    parameters: { type: 'object', properties: {}, required: [] },
    output: listOutput,
    async execute(_args, exec) {
      const wd = worlddataDir(exec, exec?.pluginConfig ?? {});
      const dir = `${wd}/.worldsea/plugins`;
      if (!existsSync(dir)) return asItems([]);
      const items = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
        .map((entry) => {
          const stat = statSync(`${dir}/${entry.name}`);
          return { id: entry.name.replace(/\.js$/, ''), file: entry.name, size: stat.size, mtime: stat.mtime.toISOString() };
        })
        .sort((a, b) => a.id.localeCompare(b.id));
      return asItems(items);
    },
  },
  {
    name: 'world_plugin_read',
    description: '读一个 WorldSea 世界树外部插件的完整源码（闭包工厂 JS）。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: '插件 id（ws. 前缀，与文件名一致）' } },
      required: ['id'],
    },
    output: looseOutput,
    async execute(args, exec) {
      const wd = worlddataDir(exec, exec?.pluginConfig ?? {});
      const id = requirePluginId(args?.id);
      const path = `${wd}/.worldsea/plugins/${id}.js`;
      if (!existsSync(path)) throw new Error(`WORLDSEA_PLUGIN_UNKNOWN: 插件不存在（${id}.js）——用 world_plugin_list 看现有清单`);
      return { id, code: fsRead(path, 'utf-8') };
    },
  },
  {
    name: 'world_plugin_write',
    description: '写入/覆盖一个 WorldSea 世界树外部插件（新建界面结构/功能的标准途径）。code = 完整插件源码：`(require) => ({ manifest, apply })` 形状的箭头函数表达式；manifest 含 id（ws. 前缀、与文件名一致）/name/version/description。原子写入，工作台 ~1s 内自动热装载（改代码同此通道）。依赖经 require 取：vue / @worldsea/entity-core / @worldsea/shared-ui。组件用 h() 渲染函数（不支持 SFC 模板编译）。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '插件 id（ws. 前缀；须与 manifest.id 和文件名一致）' },
        code: { type: 'string', description: '完整插件源码（箭头函数表达式，非 JSON）' },
      },
      required: ['id', 'code'],
    },
    output: looseOutput,
    async execute(args, exec) {
      const config = exec?.pluginConfig ?? {};
      const wd = worlddataDir(exec, config);
      requireWorkspaceRoot(exec, config);
      const id = requirePluginId(args?.id);
      const code = requireString(args?.code, 'code');
      if (!code.includes('manifest')) throw new Error('WORLDSEA_PLUGIN_BAD_CODE: code 缺少 manifest（插件源码须为 `(require) => ({ manifest, apply })` 形状；拿模板用 world_plugin_template）');
      if (!code.includes('apply')) throw new Error('WORLDSEA_PLUGIN_BAD_CODE: code 缺少 apply（装载函数）');
      const path = `${wd}/.worldsea/plugins/${id}.js`;
      mkdirSync(`${wd}/.worldsea/plugins`, { recursive: true });
      // 原子写（临时文件 + 同卷 rename）：读者不会读到半截文件（与 mutateRelations 同口径）
      const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
      try {
        writeFileSync(tmp, code);
        renameSync(tmp, path);
      } catch (error) {
        try { unlinkSync(tmp); } catch { /* 清理失败不掩盖主错误 */ }
        throw error;
      }
      return { id, file: `.worldsea/plugins/${id}.js`, note: '已写入；工作台约 1 秒内自动热装载（侧栏出现/更新视图）。若未见生效，让用户在工作台「设置 → 插件」看被拒原因。' };
    },
  },
  {
    name: 'world_plugin_delete',
    description: '删除一个 WorldSea 世界树外部插件（文件删除；工作台 ~1s 内自动卸载，其注册的视图/能力随插件清理）。内置芽（official.*）不受本工具影响。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: '插件 id（ws. 前缀）' } },
      required: ['id'],
    },
    output: looseOutput,
    async execute(args, exec) {
      const config = exec?.pluginConfig ?? {};
      const wd = worlddataDir(exec, config);
      requireWorkspaceRoot(exec, config);
      const id = requirePluginId(args?.id);
      const path = `${wd}/.worldsea/plugins/${id}.js`;
      if (!existsSync(path)) throw new Error(`WORLDSEA_PLUGIN_UNKNOWN: 插件不存在（${id}.js）`);
      unlinkSync(path);
      return { id, note: '已删除；工作台约 1 秒内自动卸载。' };
    },
  },
  {
    name: 'world_plugin_template',
    description: '返回 WorldSea 世界树外部插件的最小模板源码（world_plugin_write 的 code 素材）。用它起步，替换视图标题/渲染内容后写入。',
    parameters: { type: 'object', properties: {}, required: [] },
    output: looseOutput,
    async execute() {
      return { code: PLUGIN_TEMPLATE };
    },
  },
];

/** 安全枚举子目录（不存在 → 空数组）。 */
function readdirSafe(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${dir}/${entry.name}`);
}

//#endregion

//#region ── cordis 插件装载 ────────────────────────────────────────────

/**
 * 插件装载：注册工具集 + system prompt 指引段。
 * @param ctx - cordis 上下文（工具经 ctx.tools.register 进 Agent 工具面；
 *              指引经 ctx.systemPrompt.section 直进 system prompt）。
 * @param config - 插件配置（dshHome / dataRoot 覆盖，见文件头注）。
 */
export function apply(ctx, config = {}) {
  // 生效配置视图（2026-10-07 预设化配套）：本插件挪进「产品域模式」预设后不再是顶层装载行，
  // 设置面编辑不到自身 config——数据面真源移到 console 插件（worldsea-console，顶层常驻），
  // 经其服务桥 `worldseaDataFace` 读取（作用域继承；ctx 属性访问每次现解析，保存即生效）。
  // 回落链：console 服务 > 本插件自身 config（预设子行 config / 单独部署兜底）> 调用方再回落 env。
  // 视图用 getter 而非展开：volatile 句柄与服务值都要**每次取用时现解析**，apply 时展开会冻结旧值。
  const effectiveConfig = {
    get dshHome() { return faceValue(ctx, 'dshHome') ?? configText(config?.dshHome); },
    get dataRoot() { return faceValue(ctx, 'dataRoot') ?? configText(config?.dataRoot); },
  };

  // 工具执行时把生效配置视图带给 execute（exec.pluginConfig 由注册侧闭包注入）
  for (const tool of tools) {
    ctx.tools.register({
      ...tool,
      async execute(args, exec) {
        return tool.execute(args, { ...exec, pluginConfig: effectiveConfig });
      },
    });
  }

  // 产品域使用指引（进 system prompt；简洁——详细地图在工作区 WORLDSEA.md）。
  // 指引段失败不影响工具注册（包 try/catch——section 的 order/签名可能随版本变化）。
  try {
    ctx.systemPrompt?.section?.({
      name: 'tool:worldsea',
      order: 900, // FILE_REFERENCE 段位（'context:file-reference' 同为 900，按段名排序在其后）——指引在工具段（1000+）之前，随文件引用说明一起构成"任务语境"
      text: () =>
        'WorldSea 创作数据可直接读写：world_entity_search（按关键词/标签定位）/ world_entity_list（返回 total——超过 items 数即有更多，用 offset/limit 翻页；清单按更新时间降序稳定排序）/ world_entity_get（可带 fields 点路径按需取字段）看现有实体；' +
        '组装新实体前先 world_schema_get 拿该类型的字段与必填；写类操作（put/update/delete）完成后工作台界面会自动刷新。' +
        '★ 写前守卫：写操作的会话 cwd 必须正好是某个已登记工作区的根目录，否则报 WORLDSEA_NOT_A_WORKSPACE（防误写非项目目录）。' +
        '实体间关系用 world_relation_list / put / delete（put 前两端实体必须已存在）。' +
        '项目清单与当前项目用 world_project_list / world_project_current（项目 = dsh 工作区目录）；' +
        '你的会话工作区（cwd）就是当前项目（dsh 工作区）的根目录，创作数据在其 worlddata/ 子目录。' +
        '★ schema 快照由工作台启动时导出——若 world_schema_get 报 WORLDSEA_NO_SCHEMA_SNAPSHOT，请用户先打开一次工作台（切到工作台窗即可）再重试。' +
        '★ 新增界面结构/小功能 = 外部插件：world_plugin_template 拿模板 → world_plugin_write 写入（id 用 ws. 前缀）→ 工作台约 1 秒自动热装载出现侧栏视图；world_plugin_list / read / delete 管理。详见工作区 WORLDSEA.md 的外部插件节。' +
        '★ 详细地图见工作区根的 WORLDSEA.md（壳生成的产品域说明书：三通道判定线 + 能力桥清单，用户可编辑）。',
    });
  } catch (error) {
    console.warn('[worldsea-plugin] systemPrompt 段注册失败（工具不受影响）：', error);
  }

  console.log('[worldsea-plugin] 产品域工具集已注册（' + tools.length + ' 条 world_* 工具）');
}

//#endregion

/** 稳定导出（cordis 插件身份三件）。 */
export { name, inject };
