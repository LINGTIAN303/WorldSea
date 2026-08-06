# output-tools.ts 详细注释文档（packages/agent-runtime/tools）

> 来源：`packages/agent-runtime/src/tools/output-tools.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-24 行）

```
输出块工具集

提供 13 个交互式输出工具，用于在聊天消息中渲染 UI 组件，
替代传统的 Markdown 表格/代码块/编号列表等方式。

工具列表:
  output_table     — 表格数据
  output_choice    — 单选/多选（点击自动回传）
  output_code      — 语法高亮代码块
  output_entity_card — 实体信息卡片
  output_alert     — info/success/warning/error 提示
  output_stat      — 统计指标卡片
  output_list      — 带图标的项目列表
  output_progress  — 进度条
  output_comparison — 双栏对比视图
  output_timeline  — 时间线
  output_image     — 图片展示
  output_accordion — 可折叠内容区
  output_manuscript — 文境面板（诗歌、铭文等文学性内容）

每个工具通过 ctx.appendBlock() 将组件数据追加到当前消息，
由前端 Block 渲染器按 type 分发到对应的 Vue 组件。
```
