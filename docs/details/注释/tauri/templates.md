# templates.ts 详细注释文档（tauri）

> 来源：`apps/tauri/src/subagent/templates.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-11 行）

# 子 Agent 预设规格模板

提供常用子 Agent 的一键配置模板，用户在「子 Agent」管理页通过模板菜单
快速预填表单（ID / 名称 / 描述 / 系统提示词 / 白名单 / 最大迭代），
再按需微调后保存。

模板只做**前端预填**，不写死在后端——保持后端零默认规格、纯由用户
注册（决策点 11）。tools_whitelist 为 `undefined` 表示"继承全部工具"，
stay consistent with SubAgentView 的 textToWhitelist 语义（空 = 不设白名单）。
