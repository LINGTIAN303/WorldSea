# platform-adapters.ts 详细注释文档（packages/agent-runtime/skills）

> 来源：`packages/agent-runtime/src/skills/platform-adapters.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-19 行）

```
多平台技能格式适配器（Task 24 阶段4）

实现 WorldSea 技能与 Claude Code / Cursor 格式的双向转换。

支持的平台格式：
- Claude Code：SKILL.md（YAML frontmatter: name/description/allowed-tools/license + Markdown body）
- Cursor：.mdc（YAML frontmatter: description/globs/alwaysApply + Markdown body）
- WorldSea：skill.yaml（完整 manifest）+ SKILL.md（提示词）

导入：外部格式文本 → WorldSea SkillMeta（复用 parser.ts 的 parseFrontmatter）
导出：WorldSea SkillMeta + 提示词 body → 外部格式文本

设计要点：
- 导入时字段映射保守：外部格式无的字段用 WorldSea 默认值兜底
- 导出时只输出目标格式支持的字段，WorldSea 特有字段丢弃
- Cursor 的 globs → WorldSea 无直接对应，存入 tags 保留信息
- Claude Code 的 allowed-tools（连字符）↔ WorldSea allowedTools（驼峰）
```

## 注释块 2（原文件第 137-148 行）

```
导入 Cursor .mdc 格式

frontmatter: description, globs（文件匹配）, alwaysApply（布尔）
body: Markdown 提示词

字段映射：
- description → description（同时作为 name 兜底）
- globs → tags（保留信息，WorldSea 无 globs 概念）
- alwaysApply → autoActivate（语义近似：总是应用 vs 自动激活）
- name 缺失时用 fallbackId
```
