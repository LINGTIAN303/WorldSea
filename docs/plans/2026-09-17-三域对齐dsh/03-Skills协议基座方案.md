# Skills 协议基座方案（对齐 dsh · Skill 组）

> status: **执行中**（2026-09-17 拍板：D1 分层单源 / D2 sidecar 文件 / D3 多根+优先级 / D4 先查清再逐项裁量；按 §5.5 批次施工）
> 输入：① [01-dsh三域设计基线](01-dsh三域设计基线.md)（dsh Skill 机制）｜② [02-三域对照与建议清单](02-三域对照与建议清单.md) §七（用户裁定 D3）｜③ 本文 §三（2026-09-17 源码级补充取证，带 file:line）｜④ Agent Skills 开放规范原文（agentskills.io/specification）
> 范围：协议字段与校验 / 发现面 / 管理面 / 存量处置。**芽（sprout）所属技能本轮不动**（用户裁定：后续芽会整合成一个聚合单工具）。

---

## 一、裁定回顾（用户口径 → 本方案落点）

| 原话要点 | 落点 |
|---|---|
| 「将世界观那边的 27 芽所属 Skills 排除，它们后续会有单独改动」 | 本方案不动芽的 28 个 SKILL.md 与其元数据；§三.5 已确认芽携带机制是死声明 |
| 「除了那 27 芽所属的 Skills，应再无 Skills，当前项目应为 0 个 Skills」 | 目标状态 = 注册表只保留「芽所属 + 用户导入」；§五.4 存量处置（8 通用 + 16 instructions 类 + 1 孤儿） |
| 「应按 Skills 协议规范进行」 | §五.1 协议层：以 Agent Skills 开放规范为唯一字段口径（含校验规则） |
| 「发现面与创建/导入等管理面也要注意一下」 | §五.2 发现面（多根与优先级）+ §五.3 管理面（现状 6 命令已活，缺「创建」与「校验」） |
| 时序：T5 → 补桥 → 退役 SKILL.md | §五.5 批次（T5 已完成；补桥 kb_*/project_* 置于存量处置之前） |

---

## 二、协议规范基线

### 2.1 Agent Skills 开放规范（agentskills.io，2026-09-17 原文核对）

**目录结构**：技能 = 一个目录，至少含 `SKILL.md`；可选 `scripts/`（可执行代码）、`references/`（按需文档）、`assets/`（模板/静态资源）。

**frontmatter 字段（规范全集）**：

| 字段 | 必填 | 约束 |
|---|---|---|
| `name` | 是 | 1-64 字符；仅小写字母/数字/连字符；不得首尾连字符、不得连续连字符；**必须与父目录同名** |
| `description` | 是 | 1-1024 字符；写清「做什么 + 何时用」，含用于发现的触发关键词；建议第三人称 |
| `license` | 否 | 许可证名或随包许可证文件名 |
| `compatibility` | 否 | 1-500 字符；环境要求（目标产品 / 系统依赖 / 网络） |
| `metadata` | 否 | **string → string 映射**；客户端扩展位（键名建议加命名空间防冲突） |
| `allowed-tools` | 否 | 空格分隔字符串；预授权工具（实验性，各实现支持度不一） |

**渐进披露三级**：元数据（~100 tokens，启动时全量加载）→ SKILL.md body（建议 <5000 tokens 且 <500 行，激活时加载）→ 资源文件（按需）。引用文件用相对技能根的路径、保持一层深度。

**校验**：官方参考实现 `skills-ref validate ./my-skill`（校验 frontmatter 合法性与命名规范）。

### 2.2 dsh 侧实现（差异参考，详见 01 文档）

frontmatter 六字段 + 严格校验（非法值丢弃、旧键报错）；六级根优先级（100→600）；watcher 热重载；pre-step 目录注入 + skill 工具渐进披露 + `/name` 用户手势。本侧触发链（skill_index 段 + `load_skill` 三件套）已与其同构，差距在**字段规范、校验严格度、发现层级、热更新**。

---

## 三、本侧现状（2026-09-17 源码级取证，含 3 处事实修正）

> 基准：`P = packages/agent-runtime/src/skills/`，`T = apps/tauri/src-tauri/src/`。

### 3.1 发现面与加载链

| 环节 | 现状 | 取证 |
|---|---|---|
| 内置技能 | 37 个 SKILL.md 目录 + 16 个 instructions.md 目录；内容经 `content-map.ts` 生成 67 条显式 `import('./x?raw')`；**仓内无生成脚本**（生成器只记在 Harness 文档里） | `P/content-map.ts:1-3,6-74` |
| 加载 | 内置：查 content-map；已安装：`readInstalledSkillFile`。`promptFile` 含 `skill.md` 时剥 frontmatter 取 body，否则取全文 | `P/loader.ts:39-74`；`P/manifest.ts:134` |
| 安装技能扫描 | `scanInstalledSkills()` 扫 `~/.WorldSea/skills`（含旧 app_data/skills 迁移）；**优先序：skill.yaml > SKILL.md > instructions.md（最小构造）** | `P/manifest.ts:141,52,172-200`；`T/skills_store.rs:46-47` |
| 索引进提示词 | `buildSkillIndexPrompt()` 按 category 分组输出 `- **{id}**: {description}`（无长度约束）；拼为 `skill_index` 段 | `P/registry.ts:204-244` |

### 3.2 元数据源真相（关键）

**内置 52 项元数据只来自 TS `SKILL_REGISTRY`**（`P/registry.ts:77-84` + `data/{creation,analysis,development,communication,worldbuilding,other}.ts`）。所有内置 SKILL.md 的 frontmatter 在加载时**只被剥壳、不进任何消费方**——改 frontmatter 不影响索引、不影响工具白名单（`P/loader.ts:59-65`）。frontmatter → SkillMeta 的转换只服务**已安装技能**（`P/manifest.ts:101-125`，visibility 硬编码 `always`）。

**结论**：现状是「TS 单源（内置）+ 文件单源（安装）」，不是简单双源；但两者字段口径**不一致**（TS 独有 visibility/outputPreferences/relatedPlugins/pluginTools/examples；文件侧多出 license/compatibility/id/icon 等），且文件侧解析能力残缺（见 3.3）。

### 3.3 三处事实修正（此前口径有误）

1. **「2 处 allowed-tools 失配」不是字段名问题**：parser 同时接受 `allowed-tools` 与 `allowedTools`（`P/parser.ts:119`）；真实缺陷是**只吃块式列表**（`- ` 行），flow 风格 `allowed-tools: [a, b, c]` 整行被忽略（`:66-72,112`）。`atlas-cartographer`、`timeline-architect` 即此形态 → `allowedTools` 恒空（`P/atlas-cartographer/SKILL.md:34-45`、`P/timeline-architect/SKILL.md:10-25`）。对内置技能无实际影响（frontmatter 无消费方），**但对外部导入技能是真 BUG**。
2. **`metadata` 是死字段**：类型声明存在（`P/parser.ts:25`）但**无解析分支**（`:117-137`）→ 恒 `undefined`；规范要求支持。
3. `capabilities.plugin`（仅 `atlas-cartographer:22-33` 使用）无解析分支 → 丢失（当前无消费方）。另 `atlas` 在 `data/*.ts` 中**无 id**：SKILL.md 与 content-map 有、注册表无 → **纯孤儿**（load_skill 与索引均不可达）。

### 3.4 管理面（现状未断线）

crate `crates/worldsea-skills-store`（sha256 校验 / zip 解压 / 目录清洗 / id 校验等纯逻辑）+ `T/skills_store.rs` 6 命令：`download_manifest` / `install` / `uninstall` / `get_installed_versions` / `import_local` / `get_dir`（lib.rs:154-159 注册 + HTTP 桥同权）；前端 `SkillsStorePanel.vue` → `useSkillsStore.ts` → `skills-store.ts` 全链已接通。**缺**：创建（新写一个技能）、协议校验、版本展示字段对齐。

### 3.5 芽携带机制（死声明，本轮不动）

`agentSkills` 定义在芽 manifest 对象（如 `apps/tauri/src/sprouts/official/workflow/index.ts:10`），类型源在 entity-core（`plugin.ts:29`）。全仓 27 处赋值（芽 index.ts + `P/plugin-bridge.ts:120-373`）但**零读取点**（PluginManager/Sandbox 只读 id/name/version/permissions）→ 死声明。芽技能文件物理位置在 `P/<id>/`（28 个），`sprouts/**` 下无 SKILL.md。

### 3.6 存量清单口径（修正「37+15」）

SKILL_REGISTRY 恰 **52 项** = 36 个 SKILL.md（28 芽所属 + 8 通用）+ 16 个 instructions.md 目录；磁盘目录 53 个（多 1 = 孤儿 atlas-cartographer）；**53 个目录 0 个含 `scripts/`**，parser 亦无 scripts/languages 概念。

---

## 四、差距矩阵（协议 × 本侧）

| 维度 | 规范 / dsh | 本侧现状 | 判定 |
|---|---|---|---|
| 必填字段 | name + description（有硬校验） | 有，但无校验（name 可与目录不同名、无长度/字符约束） | 有差距 |
| 可选字段 | license / compatibility / metadata / allowed-tools | license/compatibility 已解析；`metadata` 死字段；`allowed-tools` 仅有值形态缺陷 | 有差距（小） |
| 私有字段 | 规范外（dsh 严格拒绝旧键） | TS 侧 8 个私有字段（visibility/priority/icon/category/outputPreferences/relatedPlugins/pluginTools/examples） | 需定安置方案（§五.1 / D2） |
| 校验 | 参考实现 skills-ref + dsh 严格丢弃 | 未知键静默忽略、非法值静默丢弃、无任何告警 | 有差距 |
| 渐进披露 | 三级（元数据→body→资源） | 已同构（skill_index → load_skill → load_skill_reference/asset） | 已对齐 |
| 发现层级 | dsh 六级根 + 优先级覆盖 | 两根硬编码（内置 content-map / `~/.WorldSea/skills`），无优先级、无自定义根 | 有差距（§五.2 / D3） |
| 热更新 | dsh watcher 热重载 | 无（改文件需重启/重扫） | 挂账（S4 热重载已在 02 §排除/挂账） |
| 管理面 | — | 安装/导入/卸载全活；缺创建与校验 | 有差距（§五.3） |

---

## 五、方案

### 5.1 协议层：WorldSea Skill 协议 v1

**字段口径 = 规范字段（§2.1）为唯一协议面**：

1. `name` / `description`：必填，加**强制校验**（与目录同名、kebab 规则、长度上限）——校验失败时拒绝注册并登记原因（不静默）。
2. `license` / `compatibility`：可选，直通。
3. `metadata`：按规范实现（string→string）；用 `worldsea.*` 前缀承载**显示类私有标量**（如 `worldsea.icon`、`worldsea.category`、`worldsea.priority`）。
4. `allowed-tools`：按规范空格分隔字符串解析；**同时修复 flow 数组形态**（`[a, b]` 与逗号分隔均接受，向后兼容现有块式）。
5. **编排类私有字段**（结构化：capabilities 细分 / schemaContext / outputPreferences / relatedPlugins / pluginTools / triggers / tags）安置方案见 **D2**。
6. 解析器升级：现行为行级简化解析器（`P/parser.ts`），需支持 flow 数组 + metadata 映射 + 校验分级（error / warn）；**改造保持单一入口**（loader 与 manifest 共用，勿新增第二解析器）。

**校验器**：新增纯函数 `validateSkillFrontmatter()`（规范规则集，对齐 skills-ref 的检查项）——用于 ① 安装/导入时校验 ② 内置技能测试期校验 ③ 管理面板展示。

### 5.2 发现面：多根 + 优先级（含「外部目录自动发现」机制）

现状两根硬编码。目标形态（对齐 dsh 的分层思想，但按本产品收敛）：

```
优先级（低 → 高，后者覆盖同名）：
  ① 内置技能（content-map，随包发布）
  ② 用户安装根（~/.WorldSea/skills，Skills Store 安装/本地导入）
  ③ 用户自定义根（设置可配，逗号分隔多路径；可选，按 D3 决定是否本轮做）
```

- 同名技能按优先级覆盖，覆盖登记 warning（对齐 dsh「分层覆盖」）。
- 自定义根目录的扫描规则与内置一致（目录须含 SKILL.md；名称须为合法 kebab；非合规目录进「忽略清单」并在管理面板可见）。
- 本侧**不做** dsh 式六级根（项目级/插件级等）：芽技能随芽交付（本轮不动），导入技能走安装根，二级足够；机制上与多根同构，未来可加层。

### 5.3 管理面

| 能力 | 现状 | 本批动作 |
|---|---|---|
| 安装（远程 zip + sha256）/ 本地导入 / 卸载 / 版本 | 6 命令全活 | 安装与导入链路**接入 §5.1 校验器**：不合规给结构化错误（可选项 `allowNonCompliant` 留给用户显式放行） |
| 创建 | **缺** | 新增「创建技能」：模板生成合规 `SKILL.md`（规范字段 + 推荐章节骨架）+ 目录落到安装根；前端面板加入口 |
| 展示 | 版本列表已有 | 补 `name/description/合规状态` 展示 |

### 5.4 存量处置（目标：注册表只剩芽所属 + 导入技能）

**开工前必查**：这批 id 是否被芽的 `agentSkills` / `pluginTools` / WORLDSEA.md / 提示段引用（防删后引用悬空）——逐项查清后再执行。

| 组 | 清单 | 建议动作 |
|---|---|---|
| 移工具面（5） | coding、memory、smart-fill、project-io、knowledge-base | 先**补桥**（kb_* / project_* 等，见 §5.5 批次 S3）→ 能力等价后摘注册 + 删文件 |
| 遗留清理（3） | deep-thinking、task-execution、knowledge-explorer | 摘注册 + 删文件（如能力仍有价值，逐项评估并入工具面或场景规则） |
| instructions.md 类（16） | agent-orchestrator、code-reviewer、creation-orchestrator、doc-generator、find-skills、fs-operator、git-operator、pkg-manager、security-scanner、skill-creator、sys-inspector、terminal-launcher、terminal-operator、test-automator、vision-analyzer、web-cli-operator | **同口径**：逐项查清「能力是否已有工具面承载」→ 已有则摘除，无则先并工具面再摘除 |
| 孤儿（1） | atlas-cartographer | 二选一：删除，或补注册（若其 10 个 `atlas_*` 能力仍在用，走「先查清」后补注册） |

### 5.5 批次与验收（T5 已完成 → 本方案后续）

| 批次 | 内容 | 验收 |
|---|---|---|
| S1 协议基座 | 解析器升级（flow 数组 + metadata + 校验分级）+ `validateSkillFrontmatter()` + 契约测试（含 3.3 三处修正的回归用例） | vitest 契约 + 现 52 项合规报告（只报不改） |
| S2 发现面 + 管理面 | 多根与优先级（按 D3）+ 创建向导 + 安装/导入接入校验 | 契约测试 + 真机（创建/导入/覆盖顺序） |
| S3 补桥（移工具面前置） | `kb_*`、`project_*` 等按清单补进桥（T5 已使补桥只需 TS 侧加项 + 重新生成，Rust 零改动） | 桥契约测试 + 真机（Agent 调用） |
| S4 存量处置 | §5.4 四组逐项查清 → 执行（摘注册 / 删文件 / 提示段与索引同步） | 注册表只剩芽 + 导入；真机（索引段与 load_skill 行为） |
| S5 收口 | 文档与索引同步；「独立 Skills = 0」核验 | 索引/文档断链 0 + 核验报告 |

---

## 六、裁定记录（2026-09-17 用户拍板）

| # | 决策点 | 裁定 | 生效口径 |
|---|---|---|---|
| D1 | 元数据源路径 | **分层单源** | 「真 Skills」（用户导入 + 未来技能包）以 SKILL.md frontmatter 为**唯一元数据源**；存量内置（芽 28 个 + 待处置 24 项）继续走 TS `SKILL_REGISTRY` 过渡，退役后自然收敛为零双源；**本轮不触碰芽文件** |
| D2 | 编排类私有字段安置 | **sidecar 文件**（技能目录内 `worldsea.skill.json`） | SKILL.md 只留规范字段（可移植）；sidecar 承载 capabilities 细分 / schemaContext / outputPreferences / relatedPlugins / pluginTools / triggers / tags / icon / category / visibility / priority；导入导出随包携带；缺失时按默认值降级（不阻断加载） |
| D3 | 发现面层级 | **多根 + 优先级覆盖**（内置 < 安装根） | 同名技能按优先级覆盖并登记 warning；**不引入**用户自定义根（机制同构，未来可加层——「外部目录自动发现」即在此机制上扩展） |
| D4 | 存量处置方式 | **先查清再逐项裁量** | 先出逐项查清清单（引用关系：芽 `agentSkills`/`pluginTools`/WORLDSEA.md/提示段；能力承载：是否已有工具面）→ 逐项执行（S4 批次内） |

> 拍板前选项集（D1 三选 / D2 三选 / D3 三选 / D4 三选）见本文 git 历史；本轮四项均按推荐档采纳。

---

## 七、排除项（本轮不做）

| 项 | 理由 |
|---|---|
| 芽技能本体改造（28 个 SKILL.md 的协议化） | 用户裁定：后续芽会整合成一个聚合单工具，本轮不动 |
| watcher 热重载 | 02 §挂账 S4；与「改文件即生效」的完整方案一起做 |
| dsh 式六级根优先级 | 本产品只需二级（内置 / 用户），机制同构、未来可加层 |
| SKILL.md body 的格式强约束（推荐章节） | 规范本身不限制 body 格式；仅在创建向导里给骨架模板 |
| scripts/ 执行支持 | 53 个目录 0 个使用；涉及沙箱与权限，另行立项 |

---

## 八、施工记录（滚动更新）

### S1 协议基座（2026-09-17 完成）

| 项 | 落地 |
|---|---|
| 解析器升级 | `parser.ts` 重写列表收集模型（单一 `pendingList` + `flowBuf`）：支持**单行 flow** `[a, b]`、**多行 flow**（`[` 独占一行，实际文件形态）、**分隔符字符串**（规范 `allowed-tools` 空格分隔；tags/triggers 逗号分隔）、`metadata` 映射（string→string）、**按缩进判定嵌套**（父级复位修复）；块式 `- item` 与驼峰 key 全兼容 |
| 校验器 | 新增 `validator.ts`：`validateSkillFrontmatter(fm, { dirName? })` + `isSkillCompliant`；规则 = 规范规则集（name 必填/≤64/kebab/与目录同名、description 必填/≤1024、compatibility ≤500）+ 私有顶层键 warn（D2 迁移提示）；解析保持宽容、校验独立成纯函数 |
| sidecar | 新增 `sidecar.ts`：`worldsea.skill.json` 宽容解析（坏 JSON/非法枚举 → null 降级）+ `manifest` 接入（`frontmatterToSkillMeta` 增第 4 参，私有字段 `sidecar ?? frontmatter`；`visibility`/`outputPreferences`/`relatedPlugins`/`pluginTools` 首次有来源） |
| 测试 | 新增 `src/skills/__tests__/`（3 spec / 33 用例）：解析器 17（含多行 flow 与缩进回归）+ 协议 14（校验器 + sidecar + 合并优先级）+ **真实文件实测**（`atlas-cartographer`/`timeline-architect` 的 allowed-tools 已可解析——事实修正①的端到端证据） |
| 合规报告（只报不改） | 37 个内置 SKILL.md：有 frontmatter **25** / 无 **12**；有 frontmatter 的 25 个**全部规范合规（无 error）**；12 个无 frontmatter 者 error 字段 = name, description（供 S4 逐项裁量） |
| 基础设施 | `vitest.config.ts` include 增 `packages/agent-runtime/src/skills/__tests__/**`（此前 skills 侧测试目录不存在；注释文档索引同步修正两行过时条目） |

**验证**：前端全量 vitest **51 文件 / 773 全绿**（+3 文件 / +33 用例）· agent-runtime `vue-tsc` **0 错** · 文档（03-§八 + 注释三份 + 注释索引 + 主索引）断链 0。

**S1 未包含（按批次分离）**：校验器接入安装/导入链路与面板展示（S2）；内置存量元数据不动（D1 分层单源：TS 过渡）。

### S2 发现面 + 管理面（2026-09-18 完成）

| 项 | 落地 |
|---|---|
| 发现面（D3 多根 + 优先级） | `registry.ts` 合并策略由「内置优先、同 id 静默跳过」改为 **安装根 > 内置（同名覆盖）+ warning**；新增纯函数 `mergeInstalledOverBuiltin`（可测）与 `getInstalledScanWarnings()`；合并视图 `_mergedSkills` 为唯一查询源（被覆盖内置从视图剔除）；同 id 重复目录保留首个 + warning |
| 扫描即校验 | `manifest.scanInstalledSkills` 每条目附带 `issues`（`validateSkillFrontmatter`，`dirName = 安装目录名`）；注册表收集 error 级为扫描警告（不阻断加载，面板可见） |
| 创建向导 | 新增 `creator.ts`（纯函数：`buildSkillTemplate` 生成规范 `SKILL.md` + 可选 sidecar 并**回读自检**、`composeSkillMd`、`buildSidecarJson`、`sidecarJsonFromMeta`、`validateSkillMdText`）+ `skills-store.createSkillAndReload`（校验 error 级默认拦截，可显式放行）+ 面板「创建技能」表单（ID/名称/描述/图标/优先级，实时按钮禁用） |
| 导入链路改造（D1/D2） | 本地导入不再写 legacy `skill.yaml`，改为写 **规范 SKILL.md（frontmatter 为唯一元数据源）+ 可选 sidecar**；导入前协议校验，error 级拦截并展示问题，面板提供「仍然导入（不符合协议规范）」显式放行 |
| Rust 写路径 | `worldsea-skills-store::write_skill_files` 三参改可选（skill.yaml / SKILL.md / sidecar 各写，**三者皆空报错**）；`cmd_skills_import_local` 与 HTTP 桥 `SkillsImportArgs` 同步（可选字段 + sidecar）；新增 2 项 crate 测试（md-only + sidecar / 全空拒绝） |
| 面板可见面 | 已安装 tab 顶部展示扫描警告（覆盖冲突 / 同 id 重复 / 不合规）；导入结果与创建结果均展示校验问题列表 |

**验证**：skills 侧 **4 文件 / 46 全绿**（+1 文件 / +13 用例：创建模板、导入组装、合并策略）· 前端全量 vitest **52 文件 / 786 全绿** · agent-runtime / apps/tauri / shared-composables vue-tsc **0** · `worldsea-skills-store` crate 测试全绿 · src-tauri `cargo check --all-targets` + 全量测试 **47 通过 / 0 失败**（串行）。

**S2 走查项（3 项）**：① 设置→技能面板「创建技能」填 ID/描述 → 创建成功、已安装列表出现该技能；② 本地导入一个非规范文件（如描述超 1024 或 name 非 kebab）→ 出现结构化问题提示 + 「仍然导入」按钮，放行后可导入；③ 让 Agent 用该技能（`load_skill`）→ 正常加载。

### S3 补桥（移工具面前置，2026-09-18 完成）

**查清结论（先查清后动手）**：

| 技能 | 能力依赖 | 处置 |
|---|---|---|
| coding | read_file/write_file/edit_file/search_files/list_directory/bash/powershell 等 | **无需补桥**：Rust 原生已实现且已在 `SYSTEM_BASE_TOOLS`（跨场景可见） |
| memory | memory_store/recall/delete | **无需补桥**：Rust 原生 5 件（含 update/pin）且已在各场景 tool_ids |
| knowledge-base | kb_* 9 件 | **补桥 9 件**（TS `tools/kb-tools.ts`，已在 `ALL_TOOLS_MAP` 注册） |
| project-io | project_export/project_import/consistency_check | **补桥 3 件**（`tools/project-io.ts` + `tools/daily-task.ts`） |
| smart-fill | entity_suggest_field/entity_smart_fill/entity_get_context | **补桥 3 件**（`tools/entity-crud.ts` + `tools/entity-context.ts`） |

**关键发现（可见性）**：`kb_read/kb_search/kb_write` 与 `entity_get_context` 早已在 `scenario.rs` 的 worldbuilding / 通用场景 `tool_ids` 内声明，但桥未注册 → **「声明但无实现」的悬空白名单**；S3 补桥后它们由声明变为**真实可达**。其余新增 11 项（kb_list/kb_delete/kb_extract/kb_reflect/kb_link/kb_init、project_*、consistency_check、smart-fill 2）尚不在任何白名单内 → **是否加入可见性列入 S4 逐项裁量**（D4 口径）。

**落地**：

| 项 | 落地 |
|---|---|
| 桥清单 | `BRIDGE_TOOL_NAMES` **11 → 26**（T5 单源，Rust 零改动）；生成物 `bridge_tool_specs.json` 重生成 |
| 契约测试 | Rust 快照断言 26 项（`frontend_tool_bridge.rs` 测试含演进记录）；TS 侧 `bridge-spec.spec.ts` 导入源扩至 8 个工具模块 |
| 依赖可加载 | kb 链（kb-store/kb-indexer → embedding）与 project-io/daily-task/entity-context 在 vitest 下均正常加载（生成器直接实证） |
| 呈现面 | **零改动**：前端 `toolLabels.ts` / `toolSemantics.ts` / `StepChain.vue` / `InlineToolCall.vue` 已有 kb_*/project_*/consistency_check 标签与语义条目 |
| 注释修正 | `scenario.rs` 过时注释（「tool_ids 多为表达意图、待未来注册」）已更新为现状：桥接已真实注册，本列表 = 可见性门 |

**验证**：前端全量 vitest **52 文件 / 786 全绿**（含 bridge-spec 26 项契约）· src-tauri 桥契约测试 **2/2** · kernel **287 / 0 失败** · 生成器（写入模式）与校验器（比对模式）双向通过。

**S3 走查项（2 项）**：① 世界构建会话里说「把这条设定记到知识库：…」→ Agent 调用 `kb_write` 且工具行显示「知识库写入」、执行成功；② 说「在知识库找 X」→ `kb_search` 返回结果（此前这些工具会因桥未注册而不可达）。

### S4 存量处置（2026-09-18 完成第一批：T1+T2 + 孤儿）

**裁量结果（用户拍板）**：S4-1 **T1+T2**（直接摘 4 件 + 补可见性后摘 2 件）· S4-2 smart-fill **挂账**（前端功能强引用，独立批次）· S4-3 16 个 instructions 类 **挂账，先出评估**（补桥第二批 vs 降级为规则/文档）· S4-4 孤儿 **删除** · S4-4 指引迁移按建议②（只迁必要操作约束）。

**执行内容**：

| 项 | 落地 |
|---|---|
| 可见性前置（T2） | `scenario.rs` 四场景（worldbuilding / novel / general / design）补齐 **kb 全家族（+6）** 与 **project_export/project_import/consistency_check（+3）**；编码场景按 Light 取向不动（保持 kb_read/search） |
| 注册条目摘除 | `data/analysis.ts` 移除 6 个条目（deep-thinking / task-execution / knowledge-explorer / memory / knowledge-base / project-io）并清理不再使用的 `SkillVisibility` 导入；留退役注释 |
| 文件删除 | 7 个技能目录删除（6 独立技能 + 孤儿 atlas-cartographer；含 memory/references、project-io/references） |
| 加载表同步 | `content-map.ts` 移除 7 条 SKILL.md + 2 条 references 映射（并修正一处误删：analysis-engine/references/algo-catalog.md 已恢复） |
| 引用点同步 | 群聊 `AgentCapabilityDrawer.vue` 排除集移除 `project-io`（已退役）；Rust `builtin_skills` 零命中（CodingScenario 引用的 `coding` 不在本轮范围） |
| 回归锚点更新 | `builtin-compliance.spec.ts`：flow 数组回归锚点由 atlas 改为 timeline-architect；SKILL.md 下限断言 30 → ≥25（退役 7 个后余 30） |
| 指引迁移（建议②） | `WORLDSEA.md` 能力面概览新增 3 条一行级约束：知识库路径约定（profile/project/entities/reflections/scratch）· 记忆 key 格式与去重/取代约定 · 项目导入导出与导入后 `consistency_check` |

**未做（挂账，见 04 清单）**：smart-fill（前端 `useSmartFillChat` 取工具链改造）· 16 个 instructions 类（能力承载评估）· `task_complete` 语义收敛（暂由 `plan_update` 代偿）· 关系工具族（`relation_list/create/delete` 声明但无实现）。

**验证**：前端全量 vitest **52 文件 / 786 全绿**（无残留引用）· kernel **287 / 0 失败** · agent-runtime / apps/tauri / shared-composables vue-tsc **0** · src-tauri `cargo check --all-targets` 通过 · 文档断链 0。

**S4 走查项（3 项）**：① 世界构建会话说「把这条设定记到知识库」→ `kb_write` 可用（不再需要激活知识库技能）；② 说「列出知识库条目 / 删除某条知识」→ `kb_list` / `kb_delete` 可用；③ 说「导出当前项目数据」→ `project_export` 可用（此前无可见性）。

### S4 第二批（smart-fill）与第三批（16 类 · E1/E2/E4）（2026-09-18 完成）

**第二批 · smart-fill 改造退役**：查清两点关键事实——`/skill:smart-fill` 全仓无指令处理器（惰性文本）；取工具链经 `resolveToolNames`（技能缺失会退化为仅 always-available 集）。改造：`useSmartFillChat` 改按工具名直取（`SMART_FILL_TOOL_NAMES` = 原 baseTools+allowedTools 并集，经 `ALL_TOOLS_MAP`；不再注入 SKILL_META_TOOLS）；两处 `/skill:` 前缀移除；技能退役（条目 + 加载表 + 目录）。

**第三批 · 16 个 instructions 类**（裁定 E1 摘注册+删目录 / E2 vision 补桥后退役 / E3 creation-orchestrator 挂账 / E4 只迁四类一行级）：

| 项 | 落地 |
|---|---|
| 桥（E2 前置） | `BRIDGE_TOOL_NAMES` **26 → 28**（`vision_analyze` / `list_vision_images`；桥清单与 Rust 快照同步）；可见性加入 worldbuilding / novel / design（内容·创作场景优先） |
| 退役 | **15 项**：14 个 B 档（terminal-operator / fs-operator / pkg-manager / git-operator / sys-inspector / web-cli-operator / code-reviewer / test-automator / doc-generator / security-scanner / skill-creator / find-skills / terminal-launcher / agent-orchestrator）+ vision-analyzer；注册条目（`data/development.ts` 仅留 coding；`data/communication.ts` 去 vision）+ `content-map.ts`（-15）+ 目录删除（29 文件，含 skill.yaml） |
| 引用点同步 | `orchestrator/types.ts`：六个 worker（terminal/review/research/test/doc/git）`skillIds` 清空（原引用经 `worldsea:dispatch-sub-agent` 功能流入子 Agent）；群聊 `AgentCapabilityDrawer.vue` 排除集由 16 项收敛为 2 项（retrofit-architect + creation-orchestrator） |
| 约定迁移（E4） | `WORLDSEA.md` +3 条一行级：**版本控制与工程操作**（git/包管理/系统查询走 shell）· **代码审查/测试/文档**（先读后改、跑既有命令报真实输出、文档与代码同批）· **图像理解**（vision_analyze 用途与跨厂商视觉） |
| 挂账 | creation-orchestrator（E3：与 pipeline 面 + workflow 芽 5 处引用单独议） |

**验证**：前端全量 vitest **52 文件 / 786 全绿** · kernel **287 / 0 失败** · src-tauri 桥契约 **2/2（28 项）** · agent-runtime / apps/tauri vue-tsc **0** · 文档断链 0。

**S4 走查项（补充 2 项）**：④ 内容场景里发一张图片并说「看看这张设定图」→ `vision_analyze` 可用（此前无工具承载）；⑤ 群聊面板「可选技能」列表不再出现终端/文件/审查等开发工具类技能。

### S5 收口（2026-09-18 完成）

| 项 | 落地 |
|---|---|
| coding 退役（T3） | `scenario.rs` CodingScenario `builtin_skills` 清空（原 `["coding","refactor"]`——**两个名字均非注册技能**：coding 退役后无来源，`refactor` 全仓无注册）；注册条目摘除（`data/development.ts` 清空并保留说明，含清理不再使用的 import）· `content-map.ts` · `coding/` 目录删除（SKILL.md + skill.yaml）；工具使用约定已并入 WORLDSEA.md 既有两条 |
| 核验发现的 2 项遗漏（用户裁定一并退役） | `relation-explorer` 与 `data-analyst` 不在任何芽的 `agentSkills` 声明中（属 S4 清单遗漏的独立技能）→ 退役（`data/other.ts` 条目 + `content-map.ts` + 目录删除，含 data-analyst 的图片资产）；`WORLDSEA.md` +1 条约定（关系与数据分析） |
| **「独立 Skills = 0」核验（回归守卫）** | 新增 `packages/agent-runtime/src/skills/__tests__/registry-ownership.spec.ts`：断言 **SKILL_REGISTRY ⊆ 芽声明集合（`WORLD_SMITH_PLUGIN_CAPABILITIES.agentSkills` 并集）∪ 挂账白名单**；并附快照断言（注册表 27 项 = 26 芽所属 + 1 挂账；13 个已退役代表 id 不复活） |
| 核验结论 | 注册表 **27 项**：26 项为芽所属、1 项为挂账（creation-orchestrator，E3）；**独立技能（非芽所属且非挂账）= 0** ✔ |

**累计退役（S4-S5）**：**26 项** = 8 通用 SKILL.md（memory / knowledge-base / knowledge-explorer / deep-thinking / task-execution / project-io / smart-fill / coding）+ 16 个 instructions 类中的 15（含 vision-analyzer）+ 2 项遗漏独立技能（relation-explorer / data-analyst）+ 孤儿 atlas-cartographer。

**剩余挂账**：① creation-orchestrator（E3：与 pipeline 面 + workflow 芽 5 处引用单独议）② `task_complete` 语义收敛（暂由 `plan_update` 代偿）③ 关系工具族 `relation_*` 在场景声明但无实现（第二批补桥候选）。

**验证**：前端全量 vitest **53 文件 / 788 全绿**（+1 spec / +2 用例）· kernel **287 / 0 失败** · agent-runtime vue-tsc **0** · 文档断链 0。

**S5 走查项（1 项）**：⑥ 编码场景（或任意场景）里说「帮我读一下这个文件 / 改一下代码」→ 原生工具（read_file/edit_file/bash）直接可用（不再依赖 coding 技能）。