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

解析能力（覆盖 WorldSea 原生 skill.yaml + Claude Code SKILL.md 两种格式）：
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

## 注释块 3（2026-09-17 S1 协议基座升级；代码内现为 3 行简要注释）

```
2026-09-17 协议基座升级（S1）：支持 flow 风格数组（[a, b]）与分隔符字符串
（规范 allowed-tools 为空格分隔）、metadata 映射（string→string）、按缩进判定嵌套键。
校验规则不在此处（解析保持宽容），见同目录 validator.ts。
```

升级内容与背景（补充说明）：

- **触发**：对齐 Agent Skills 开放规范（agentskills.io）过程中发现三处解析缺口——
  ① flow 风格数组 `allowed-tools: [a, b]` 整行被丢弃（原实现只在「键后无值」时进入块式收集，
  有值时既不取值也不收集）→ `atlas-cartographer` / `timeline-architect` 的 allowedTools 恒空；
  ② `metadata` 有类型声明但无解析分支（恒 undefined）；
  ③ 嵌套父级标记（`inCapabilities` 等）置位后不复位——后续顶层同名子键
  （如 `cli:`）会被误当嵌套通道吞掉。
- **取值形态**（列表键，优先级从高到低）：
  `[a, b]`（flow 数组，项内引号会被剥离）→ 非空行内值按分隔符切分
  （`allowed-tools`/`base-tools` 空格或逗号；`tags`/`triggers`/`capabilities.*`/`entity-types` 逗号）
  → 空值进入块式收集（`- item` 行）。
- **嵌套判定**：以行首缩进为准（有前导空白 = 嵌套行）；嵌套行只在对应父级在位时被解释
  （`metadata` / `capabilities` / `schema-context`），无父级的缩进行忽略（宽容）。
  遇到新顶层键时嵌套父级与块式列表状态一并复位。
- **兼容性**：连字符与驼峰两种 key 风格继续并存（`allowed-tools`/`allowedTools` 等）；
  `allowedTools` 非空且无 `capabilities` 时仍兜底并入 `internal`（原行为保留）。
- **不做**：校验/报错不在此层——`parseFrontmatter` 保持宽容（返回可解析到的最多信息），
  合法性判断交 `validator.ts` 的 `validateSkillFrontmatter`。
- **约束本次未动**：芽（sprout）所属 28 个 SKILL.md 不在本轮改动范围（用户裁定）。
