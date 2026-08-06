# pipeline-tools.ts 详细注释文档（packages/agent-runtime/tools）

> 来源：`packages/agent-runtime/src/tools/pipeline-tools.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-14 行）

```
创作编排工具集（Agent Tool）

9 个工具，让 Agent 管理创作 Pipeline：
- pipeline_create / pipeline_update / pipeline_delete: CRUD
- pipeline_list / pipeline_get: 查询
- pipeline_run_step: 执行单个步骤（派发创作子 Agent）
- pipeline_propose: 根据目标自动提议 Pipeline
- pipeline_template_list / pipeline_template_apply: 模板操作

核心设计：pipeline_run_step 通过 CustomEvent 派发创作子 Agent，
子 Agent 拥有独立上下文和工具集，自主完成创作任务。
前端 useOrchestrator 监听事件，创建子 Agent 实例并管理生命周期。
```
