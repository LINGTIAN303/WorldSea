# registry.ts 详细注释文档（packages/agent-runtime/skills）

> 来源：`packages/agent-runtime/src/skills/registry.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。
> 拆分记录（2026-08-06）：SKILL_REGISTRY 数据数组按类别拆入 skills/data/。

## 注释块 1（原文件第 60-71 行）

```
Skill 注册中心

定义所有 WorldSea Skill 的元数据和工具权限。
核心功能：
- ALWAYS_AVAILABLE_TOOLS: 所有技能下始终可用的工具白名单
- SKILL_REGISTRY: 所有技能的静态配置数组
- resolveToolNames: 根据激活技能合并可用工具集
- buildSkillIndexPrompt: 生成 Skill 列表的系统提示词
- buildOutputGuidePrompt: 生成输出通道偏好的提示词
- validateRegistryConsistency: 注册表一致性校验
```

## 注释块 2（原文件第 1420-1433 行）

```
根据激活的技能 ID 列表合并可用工具集

合并逻辑：
1. 以 ALWAYS_AVAILABLE_TOOLS 为基础工具集
2. 遍历每个激活技能，累加其 baseTools
3. 若技能配置了 capabilities，则通过 CAPABILITY_TO_TOOL
   映射表将 internal/cli/mcp 能力转换为对应工具名
4. 否则累加 allowedTools
5. 返回去重后的工具名称数组

@param activeSkillIds - 当前激活的技能 ID 数组
@returns 合并后的可用工具名称数组
```

## 注释块 3（原文件第 1462-1476 行）

```
生成技能列表的系统提示词

按 category 分组列出当前可见的技能：
- domain → 世界观领域
- action → 通用操作
- persona → 人格/角色

各类别内按 priority 降序排列。若存在因 developer/advanced 模式隐藏的技能，
会在末尾附加隐藏提示信息。

@param developerMode - 是否开启开发者模式（显示 developer 级别技能）
@param advancedMode - 是否开启高级模式（显示 advanced 级别技能）
@returns 格式化的技能索引提示词文本
```

## 注释块 4（原文件第 1562-1574 行）

```
校验技能注册表一致性

检查项包括：
- 必填字段是否缺失（基于 SKILL_META_REQUIRED_FIELDS）
- version 字段是否符合 semver 格式
- visibility 字段是否存在
- visibility 值与 getSkillVisibility() 的一致性
- persona 类别技能必须使用 always 可见性
- 是否存在重复的技能 ID

@returns 警告信息数组，无问题返回空数组
```

## 注释块 5（原文件第 1618-1631 行）

```
任务3 接线：注册到全局 SkillRegistry

将本地 SKILL_REGISTRY 同步到 @worldsea/agent-core 的全局 SkillRegistry，
使其成为技能查询的统一入口（供未来消费方使用）。

设计说明：
- SkillDeclaration（agent-core）是 SkillMeta 的声明式子集，
  capabilities/schemaContext/pluginTools 等扩展字段仅保留在 SkillMeta，
  SkillRegistry 只承载声明式字段（id/name/icon/.../baseTools/allowedTools/visibility）。
- 幂等：重复调用会清空后重新注册。
- 运行时 resolveToolNames 等函数仍用本地逻辑（依赖 ALWAYS_AVAILABLE_TOOLS），
  待工具 meta 补全 alwaysAvailable 后再切换到 SkillRegistry.resolveToolNames。
```

## 注释块 6（原文件第 1699-1710 行）

```
初始化技能注册表：扫描已安装技能并合并（Task 24 阶段1）

流程：
1. 扫描 app_data_dir/skills/ 目录（非 Tauri 环境返回空，零回归）
2. 去重：已安装技能 id 若与内置技能冲突，跳过（内置优先）
3. 填充 _installedSkills 和 _installedSkillDirs
4. 重新注册到全局 SkillRegistry（含已安装技能）

幂等：重复调用会清空已安装技能后重新扫描填充。
应在 createWorldSeaAgent 前 await 调用一次。
```

## 注释块 7（2026-09-18 S2 发现面：D3 优先级合并）

```
合并内置与已安装技能（D3 裁定：安装根 > 内置，同名覆盖并登记 warning）
纯函数（可测）：返回覆盖后的合并列表；warnings 数组由调用方传入并累积。
```

变更说明（取代注释块 6 第 2 步的旧口径）：

- **合并策略反转**：原「内置优先、同 id 静默跳过」→ **安装根 > 内置**（同名覆盖 + 登记 warning），
  被覆盖的内置条目从合并视图（`_mergedSkills`，`getAllRegisteredSkills` 唯一返回源）中剔除；
  理由：用户显式安装的技能应生效，且不静默（对齐 dsh 分层覆盖）。
- **新增可见面**：`getInstalledScanWarnings()` 返回上次扫描登记的警告
  （覆盖冲突 / 安装根内同 id 重复目录保留首个 / 条目协议校验 error 级），供面板与调用方展示。
- **扫描即校验**：`scanInstalledSkills` 每条目携带 `issues`（`validateSkillFrontmatter`，
  `dirName = 安装目录名`）；注册表把 error 级问题并入扫描警告（不阻断加载）。
