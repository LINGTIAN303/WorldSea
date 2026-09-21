# manifest.ts 详细注释文档（packages/agent-runtime/skills）

> 来源：`packages/agent-runtime/src/skills/manifest.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-22 行）

```
已安装技能 Manifest 解析器（Task 24 阶段1）

从 app_data_dir/skills/ 目录扫描已安装技能（Skills Store 通过 Git 安装），
解析其 manifest（skill.yaml 优先，SKILL.md frontmatter 降级），转换为 SkillMeta。

已安装技能目录结构：
  <app_data_dir>/skills/
    my-skill/
      skill.yaml          # 完整 manifest（优先，WorldSea 原生格式）
      SKILL.md            # 提示词（Claude Code 标准格式，frontmatter 作为 manifest 降级源）
      references/         # 参考文档
      assets/             # 资源文件
      instructions.md     # 备选提示词

设计要点：
- 仅在 Tauri 环境工作；非 Tauri（如 vitest）返回空数组，零回归。
- 不依赖 loader.ts / registry.ts，避免循环依赖。
- 复用 parser.ts 的 parseFrontmatter（支持 capabilities/schemaContext 嵌套），
  skill.yaml 包装成 frontmatter 格式后统一解析，两种格式能力等价。
- 禁止 emoji 图标：检测到 emoji 时替换为默认图标（项目规范）。
```

## 注释块 2（原文件第 151-162 行）

```
扫描已安装技能目录，返回所有有效技能的 manifest

流程：
1. 获取 skills 根目录（cmd_skills_get_dir）
2. 列举子目录（cmd_fs_list）
3. 每个子目录优先读 skill.yaml（包装成 frontmatter 解析），降级读 SKILL.md frontmatter
4. 检测提示词文件（SKILL.md → instructions.md），设 promptFile
5. frontmatterToSkillMeta 转换为 SkillMeta

非 Tauri 环境或目录为空时返回空数组（零回归）。
```

## 注释块 3（2026-09-17 S1 协议基座：sidecar 接入）

```
sidecar（worldsea.skill.json）：D2 裁定的私有字段权威源（缺失即降级，不阻断）
frontmatterToSkillMeta(..., sidecar?)：sidecar 为私有字段权威源，frontmatter 顶层私有键仅作过渡兜底
```

变更说明（补充）：

- **扫描链路新增一步**：每个已安装技能目录在读出提示词文件后，再读 `worldsea.skill.json`
  （`parseWorldSeaSkillSidecar` 宽容解析，坏 JSON/非法字段 → null 降级，不阻断技能加载）。
- **`frontmatterToSkillMeta` 增第 4 参**（可选，向后兼容）：私有字段按
  `sidecar?.x ?? fm.x` 合并——`icon` / `category` / `capabilities` / `schemaContext` /
  `triggers` / `tags` / `priority` / `autoActivate`，并新增 `visibility` /
  `outputPreferences` / `relatedPlugins` / `pluginTools` 的来源（此前 visibility 硬编码 `always`、
  后三者无来源）。
- **规范字段不落 SkillMeta**：`license` / `compatibility` / `metadata` 由 parser 解析后保留在
  frontmatter 层（供管理面展示与合规校验），不进入运行时 SkillMeta。
- **内置技能不受影响**：内置元数据仍来自 TS `SKILL_REGISTRY`（D1 分层单源：存量内置走 TS 过渡）。
