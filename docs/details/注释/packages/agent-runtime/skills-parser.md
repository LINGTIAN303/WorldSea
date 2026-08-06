# parser.ts 详细注释文档（packages/agent-runtime/skills）

> 来源：`packages/agent-runtime/src/skills/parser.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-17 行）

```
SKILL.md / skill.yaml frontmatter 解析器

从 loader.ts 提取，供 loader.ts 和 manifest.ts 共用，避免循环依赖。

支持格式：
- SKILL.md：`---\n<yaml>\n---\n<body>` 标准 frontmatter
- skill.yaml：无 --- 分隔的纯 YAML（由调用方包装后传入）

解析能力（覆盖 WorldSmith 原生 skill.yaml + Claude Code SKILL.md 两种格式）：
- 标量字段：id/name/description/icon/category/priority/auto-activate/license/compatibility/enabled/version
- 列表字段：allowed-tools/allowedTools、baseTools/base-tools、triggers、tags
- 嵌套对象：capabilities.internal/cli/mcp、schema-context.entity-types

同时识别连字符（allowed-tools）和驼峰（allowedTools）两种 key 风格，
确保多平台技能格式互通（Task 24 阶段4 多平台适配器基础）。
```

## 注释块 2（原文件第 46-63 行）

```
解析 YAML frontmatter

支持格式：
  ---
  name: xxx
  description: xxx
  allowed-tools:        # 或 allowedTools
    - tool_a
  capabilities:
    internal:
      - entity.list
  ---
  (body)

注意：这是一个简化的行级解析器，不是完整的 YAML 解析器。
支持一层嵌套列表（capabilities 下的 internal/cli/mcp，schema-context 下的 entity-types）。
```
