# validator.ts / sidecar.ts 详细注释文档（packages/agent-runtime/skills）

> 来源：`packages/agent-runtime/src/skills/validator.ts`、`sidecar.ts` 中连续 ≥ 10 行的长注释块，迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。
> 新增于 2026-09-17（S1 协议基座，三域对齐 dsh · Skill 组）。

## validator.ts · 注释块 1（文件头）

```
Skill 协议校验器（S1 协议基座，2026-09-17）

规则集对齐 Agent Skills 开放规范（agentskills.io/specification）：
- name：必填，1-64 字符，仅小写字母/数字/连字符，不得首尾连字符、不得连续连字符，且必须与父目录同名
- description：必填，1-1024 字符
- compatibility：可选，1-500 字符
- license / metadata / allowed-tools：可选（形态由 parser 保证）

另按本侧 D2 裁定（SKILL.md 只留规范字段、私有字段进 sidecar）对顶层私有键给 warn——
过渡期不阻断（存量安装技能可能仍带私有键），仅提示迁移。

调用方约定：error 级问题用于拒绝注册/安装（或经显式放行开关跳过）；
warn 级仅登记展示。纯函数、无副作用。
```

设计要点（补充）：

- **为什么解析器不校验**：frontmatter 解析保持宽容（历史文件形态杂、内置技能不走此链），
  校验独立成纯函数——同一份 frontmatter 可被不同调用方按不同严格度使用
  （扫描=登记 warn / 安装=拒绝 error / 测试=断言）。
- `opts.dirName` 可选：规范要求 name 与父目录同名，但该规则只在「目录即技能包」的场景成立
  （内置技能目录名未必等于 skill id），故由调用方决定是否传入。
- 私有键 warn 清单含 `allowedTools`/`baseTools`/`capabilities`/`schemaContext` 等编排字段——
  它们按 D2 应迁 sidecar；空数组不报（`allowedTools: []` 是解析器默认值，不是用户书写）。

## sidecar.ts · 注释块 1（文件头）

```
WorldSea Skill sidecar（worldsea.skill.json）（S1 协议基座，2026-09-17）

D2 裁定：SKILL.md 只保留规范字段（name/description/license/compatibility/metadata/allowed-tools），
本侧编排类私有字段（结构化）由技能目录内的 sidecar 文件承载——SKILL.md 保持可移植，
私有字段有 JSON schema 级的承载位；导入/导出随包携带；缺失时按默认值降级，不阻断加载。

读取时机：已安装技能扫描（manifest.scanInstalledSkills）；内置技能不走 sidecar（元数据来自 TS 注册表）。
```

设计要点（补充）：

- **宽容解析（fail-soft）**：坏 JSON / 非对象 / 全字段非法 → 返回 `null`，调用方按「无 sidecar」降级；
  绝不抛错——sidecar 是增强位，缺失不应让技能不可用。
- **字段级过滤**：枚举（category/visibility）与通道（outputPreferences.channel）按白名单过滤，
  未知键静默丢弃；`capabilities` 三通道与 `schemaContext.entityTypes` 走数组/映射守卫。
- **合并优先级**（`manifest.frontmatterToSkillMeta`）：sidecar 为私有字段权威源，
  frontmatter 顶层私有键仅作过渡兜底（`sidecar?.x ?? fm.x`）；
  `visibility` 默认 `always`、`priority` 默认 `5`。