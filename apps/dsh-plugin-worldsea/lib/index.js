/**
 * dsh-plugin-worldsea — WorldSea 产品域工具集（D2，2026-09-28；内置级 cordis 插件，零依赖）。
 *
 * 角色：让 Agent 以**原生工具**（与 fs/terminal 同级）直接读写工作台创作数据。
 * 执行体 = 直接读写 `worlddata/` 透明 JSON（与工作台 FileStorageBackend 同真相源）；
 * 外部写入经工作台 FsWatcher 天然刷新 UI（自身写入静默期不覆盖外部路径）——无需任何通知通道。
 *
 * 口径（D2 批计划 §1.1）：**项目 = dsh 工作区**——工具的实体目录 = 会话 cwd 下的 `worlddata/`
 * （cwd 来自 `exec.agent.session.header.cwd`，与会话的 workspace 对齐）。
 *
 * 依赖策略：**零 import**（对齐 dsh-plugin-community 先例）——工具对象按 ToolDefinition
 * 形状手写（register 校验 output {schema, render} 子集；参数校验在 execute 内自查），
 * 规避 @deepseek-ai scope 私有包在 link: 目录下的解析问题。
 *
 * 配置（cordis.patch.yml 的插件 config）：
 * - `dshHome`：DSH_HOME 覆盖（缺省读 `process.env.DSH_HOME`）
 * - `dataRoot`：无会话 cwd 时的实体目录兜底（缺省无——非会话调用直接拒，fail loud）
 *
 * schema 快照：`<worlddata>/.worldsea/schema-snapshot.json`（工作台启动/重播种时导出），
 * put/update 用它做「类型存在 + 必填字段」轻校验。快照缺失时写操作拒（提示先开一次工作台）。
 */

/** 稳定 cordis 插件名（内置插件页显示的包标识）。 */
const name = 'worldsea';

/** 前置服务：工具注册面 + system prompt 指引段（缺失即 `cannot get property "tools" without inject`）。 */
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

/** node:fs 惰性静态绑定（ESM 顶层 import 也无妨——零依赖指无第三方包）。 */
import { readFileSync as fsRead, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

/** 写 JSON（自动建父目录）。 */
function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

/** 会话工作区 cwd（与 tool-fs 的 session-cwd 同源口径）。 */
function sessionCwd(exec) {
  return exec?.agent?.session?.header?.cwd;
}

/** 实体数据根 = 会话 cwd/worlddata；无会话 cwd 且未配置兜底 → fail loud。 */
function worlddataDir(exec, config) {
  const cwd = sessionCwd(exec);
  if (cwd) return join(cwd, 'worlddata');
  if (config?.dataRoot) return join(config.dataRoot, 'worlddata');
  throw new Error('WORLDSEA_NO_SESSION: 本工具需要会话工作区上下文（cwd）——请从会话内调用，或在插件 config.dataRoot 配置兜底目录');
}

/** DSH_HOME（与壳的 spawn 口径同源）：config.dshHome 覆盖 > process.env.DSH_HOME。 */
function dshHome(config) {
  return config?.dshHome || process.env.DSH_HOME || null;
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
  return readJsonDir(dir).find((entry) => entry.value?.id === id) ?? null;
}

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

/** 必填非空字符串参数自查。 */
function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`WORLDSEA_BAD_ARGS: ${field} 必填（非空字符串）`);
  return value;
}

const tools = [
  {
    name: 'world_project_list',
    description: '列出 WorldSea 的项目（项目 = dsh 工作区目录，同源模型）：id / 名称 / 目录 path。当前项目的数据宇宙 = 会话 cwd。',
    parameters: { type: 'object', properties: {}, required: [] },
    output: looseOutput,
    async execute(_args, exec) {
      return readDshWorkspaces(exec?.pluginConfig ?? {});
    },
  },
  {
    name: 'world_schema_get',
    description: '读 WorldSea 实体类型的字段 schema（typeKey/label/必填字段）。组装实体数据前先取它；type 省略 = 全部类型。',
    parameters: {
      type: 'object',
      properties: { type: { type: 'string', description: '实体类型 typeKey（如 character）；省略 = 全部' } },
      required: [],
    },
    output: looseOutput,
    async execute(args, exec) {
      const wd = worlddataDir(exec, exec?.pluginConfig ?? {});
      const snapshot = readSchemaSnapshot(wd);
      if (args?.type) return schemaOf(snapshot, requireString(args.type, 'type'));
      return snapshot;
    },
  },
  {
    name: 'world_entity_list',
    description: '列出 WorldSea 创作数据里的实体（瘦身：id/type/name）。字段详情用 world_entity_get。',
    parameters: {
      type: 'object',
      properties: { type: { type: 'string', description: '按实体类型过滤（typeKey）；省略 = 全部' } },
      required: [],
    },
    output: looseOutput,
    async execute(args, exec) {
      const wd = worlddataDir(exec, exec?.pluginConfig ?? {});
      const type = args?.type ? requireString(args.type, 'type') : null;
      const dirs = type ? [entitiesTypeDir(wd, type)] : readdirSafe(entitiesDir(wd));
      const out = [];
      for (const dir of dirs) {
        for (const entry of readJsonDir(dir)) {
          if (entry.value?.id && entry.value?.type) out.push({ id: entry.value.id, type: entry.value.type, name: entry.value.name });
        }
      }
      return out;
    },
  },
  {
    name: 'world_entity_get',
    description: '读取 WorldSea 实体的完整数据（含 properties 字段）。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: '实体 id' } },
      required: ['id'],
    },
    output: looseOutput,
    async execute(args, exec) {
      const wd = worlddataDir(exec, exec?.pluginConfig ?? {});
      const id = requireString(args?.id, 'id');
      const hit = findFileById(entitiesDir(wd), id);
      if (!hit) throw new Error(`WORLDSEA_ENTITY_UNKNOWN: 实体不存在（${id}）`);
      return hit.value;
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
    description: '按 id 局部更新 WorldSea 实体（changes 只传要改的字段）。写后工作台界面自动刷新。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '实体 id' },
        changes: { type: 'object', description: '要改的字段（name/description/properties/tags…）' },
      },
      required: ['id', 'changes'],
    },
    output: looseOutput,
    async execute(args, exec) {
      const wd = worlddataDir(exec, exec?.pluginConfig ?? {});
      const id = requireString(args?.id, 'id');
      if (!args?.changes || typeof args.changes !== 'object') throw new Error('WORLDSEA_BAD_ARGS: changes 必须是对象');
      const hit = findFileById(entitiesDir(wd), id);
      if (!hit) throw new Error(`WORLDSEA_ENTITY_UNKNOWN: 实体不存在（${id}）`);
      const updated = { ...hit.value, ...args.changes, id: hit.value.id, type: hit.value.type, updatedAt: new Date().toISOString() };
      writeJson(hit.file, updated);
      return { id, name: updated.name };
    },
  },
  {
    name: 'world_entity_delete',
    description: '按 id 删除 WorldSea 实体（不可恢复，谨慎）。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: '实体 id' } },
      required: ['id'],
    },
    output: looseOutput,
    async execute(args, exec) {
      const wd = worlddataDir(exec, exec?.pluginConfig ?? {});
      const id = requireString(args?.id, 'id');
      const hit = findFileById(entitiesDir(wd), id);
      if (!hit) throw new Error(`WORLDSEA_ENTITY_UNKNOWN: 实体不存在（${id}）`);
      unlinkSync(hit.file);
      return { id };
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
  // 工具执行时把本插件 config 带给 execute（exec.pluginConfig 由注册侧闭包注入）
  for (const tool of tools) {
    ctx.tools.register({
      ...tool,
      async execute(args, exec) {
        return tool.execute(args, { ...exec, pluginConfig: config });
      },
    });
  }

  // 产品域使用指引（进 system prompt；简洁——详细地图在工作区 WORLDSEA.md）。
  // 指引段失败不影响工具注册（包 try/catch——section 的 order/签名可能随版本变化）。
  try {
    ctx.systemPrompt?.section?.({
      name: 'tool:worldsea',
      order: 900, // 工具段之后的追加位（数字直接给——自定义段名不在预声明排序表内）
      text: () =>
        'WorldSea 创作数据可直接读写：world_entity_list / world_entity_get 看现有实体；' +
        '组装新实体前先 world_schema_get 拿该类型的字段与必填；写类操作（put/update/delete）完成后工作台界面会自动刷新。' +
        '项目清单用 world_project_list（项目 = dsh 工作区目录）；你的会话工作区（cwd）就是当前项目的宇宙根，创作数据在其 worlddata/ 子目录。',
    });
  } catch (error) {
    console.warn('[worldsea-plugin] systemPrompt 段注册失败（工具不受影响）：', error);
  }

  console.log('[worldsea-plugin] 产品域工具集已注册（' + tools.length + ' 条 world_* 工具）');
}

/** 稳定导出（cordis 插件身份三件）。 */
export { name, inject };
