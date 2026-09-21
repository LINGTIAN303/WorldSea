# skills-store.ts 详细注释文档（packages/agent-runtime/skills）

> 来源：`packages/agent-runtime/src/skills/skills-store.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 211-221 行）

```
本地导入技能：写入 skill.yaml + SKILL.md 到 app_data_dir/skills/<skillId>/

用于多平台互通：前端用 platform-adapters 解析 Claude Code/Cursor/WorldSea 格式，
生成标准 skill.yaml + SKILL.md 文本后调用本函数写入。已存在同名技能则覆盖。

注意：此函数不触发重新扫描。导入后需调用 initSkillRegistry() 才能使技能生效。
通常用 importLocalSkillAndReload 一步完成导入+重扫。

@returns 安装结果；非 Tauri 环境返回 null
```

## 注释块 2（2026-09-18 S2 管理面：写入路径变更 + 创建入口）

```
本地导入参数（2026-09-18 S2 协议基座：改为 SKILL.md + sidecar 落盘）
skillYaml？  legacy 路径（新流程不写）；skillMd 含规范 frontmatter（唯一元数据源）；sidecarJson D2 私有字段承载
```

变更说明（补充）：

- **落盘形态（D1/D2）**：本地导入不再生成 legacy `skill.yaml`，改为
  「规范 `SKILL.md`（frontmatter=name/description 为唯一元数据源）+ 可选 `worldsea.skill.json`（私有字段）」；
  Rust 侧 `write_skill_files` 三类文件均可选（三者皆空报错）。
- **导入前置校验**：`validateSkillMdText(skillMd, skillId)`（error 级拦截，`allowNonCompliant` 显式放行），
  校验口径见 `../使用方`（composable `useSkillsStore.importLocal` 与面板「仍然导入」按钮）。
- **新增创建入口**：`createSkillAndReload(input, { allowNonCompliant })` ——
  经 `creator.buildSkillTemplate` 生成规范 SKILL.md + sidecar（生成物回读自检）后写入安装根；
  返回 `CreateSkillOutcome{ ok, issues, result }`。
- **落盘后**：均调用 `initSkillRegistry()` + `notifySessionPromptDirty('skills-*')`，使技能立即进入索引与提示词。
