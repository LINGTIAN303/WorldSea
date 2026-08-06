# workflowApi.ts 详细注释文档（tauri）

> 来源：`apps/tauri/src/plugins/workflow/api/workflowApi.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 6-25 行）

Workflow 引擎 Tauri 命令调用层

镜像 src-tauri/src/workflow/commands/ 下 28 个 #[tauri::command]：
  - definitions.rs (7): list / get / create / update / delete / export / import
  - dry_run.rs     (1): dry_run
  - runs.rs        (9): run / run_sync / pause / resume / cancel / skip_to / status / list_runs / get_run
  - dispatch.rs    (4): node_result / node_chunk / node_heartbeat / node_cancel_ack
  - node_meta.rs   (4): list_node_types / get_node_schema / register_node_type / unregister_node_type
  - settings.rs    (3): get_setting / set_setting / purge_runs_now

设计要点：
  - 命令名（invoke 第一参数）保持 snake_case，与 Rust 端 #[tauri::command] 函数名一致
  - 参数名用 camelCase（TS 惯例），Tauri 自动转换为 Rust 端的 snake_case
  - 返回值类型镜像 Rust 端 struct（RunStatusInfo / WorkflowSummaryDto / DryRunResult 等）
  - serde_json::Value 返回值暂用 unknown，调用方按需断言

P0-1-A1：Run History 持久化主用 runs 系列（list_runs / get_run / status / cancel）
P0-1-B1：直接 Dispatch 兜底主用 workflow_run + node_chunk 回调
