# skills-store.ts 详细注释文档（packages/agent-runtime/skills）

> 来源：`packages/agent-runtime/src/skills/skills-store.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 211-221 行）

```
本地导入技能：写入 skill.yaml + SKILL.md 到 app_data_dir/skills/<skillId>/

用于多平台互通：前端用 platform-adapters 解析 Claude Code/Cursor/WorldSmith 格式，
生成标准 skill.yaml + SKILL.md 文本后调用本函数写入。已存在同名技能则覆盖。

注意：此函数不触发重新扫描。导入后需调用 initSkillRegistry() 才能使技能生效。
通常用 importLocalSkillAndReload 一步完成导入+重扫。

@returns 安装结果；非 Tauri 环境返回 null
```
