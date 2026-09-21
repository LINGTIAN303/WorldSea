# creator.ts 详细注释文档（packages/agent-runtime/skills）

> 来源：`packages/agent-runtime/src/skills/creator.ts` 中连续 ≥ 10 行的长注释块，迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。
> 新增于 2026-09-18（S2 管理面，三域对齐 dsh · Skill 组）。

## 注释块 1（文件头）

```
技能创建/导入组装层（S2 管理面，2026-09-18）

职责：把「创建技能」与「本地导入」两路输入组装成协议基座要求的落盘形态——
规范 SKILL.md（frontmatter 为唯一元数据源）+ 可选 sidecar（D2 私有字段）。
纯函数（除校验外无副作用），生成结果可直接交 skills-store 写入。

校验口径：生成后回读解析再交给 validator（自检生成物本身合规），
error 级问题由调用方决定拦截或经 allowNonCompliant 放行。
```

设计要点（补充）：

- **为什么生成后回读自检**：模板是字符串拼接，若拼出非法 frontmatter（如描述里的换行破坏
  行级解析），直接写盘会产出「不合规技能」。`buildSkillTemplate` 因此把生成物再经
  `parseFrontmatter + validateSkillFrontmatter` 走一遍，把问题作为 `issues` 返回——
  调用方（`createSkillAndReload` / 面板）据此拦截或放行。
- **描述压平**：行级解析器要求 `description` 为单行，`inlineValue` 统一把折行压成空格。
- **私有字段边界**：`buildSidecarJson`（创建）只收编用户填写的 icon/category/priority/tags；
  `sidecarJsonFromMeta`（导入）收编 SkillMeta 的私有字段，且**默认值不入 sidecar**
  （`icon=module-builder`、`visibility=always` 为省缺省值；priority 为数值无「默认即不写」语义，仍写入）。
- **导入重组的元数据边界**：导入时 frontmatter 只写规范必填字段（name/description）——
  `name` 取 `meta.id`（目录名），保证规范「name 必须与父目录同名」恒成立。
- **不负责**：落盘（`skills-store.importLocalSkill` / `createSkillAndReload`）与面板交互。