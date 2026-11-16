---
status: 现行
date: 2026-11-17
scope: Tauri 命令面
---

# Tauri 命令面

> 回答「Rust 侧到底有多少命令、怎么分族、ACL 对得上吗」。
> 实现：`apps/tauri/src-tauri/src/`（80 个 `.rs` / 14,007 行）；注册表在 `lib.rs` 的 `generate_handler!`。

## 一、99 条命令，一一对应

`#[tauri::command]` 实测 **99 个函数**，`generate_handler!` 注册 **99 条**，无缺无多。这是 2026-11-17 实测值（旧文档写 91 / 98，均已过时）。

| 文件 | 条数 | 命令名 |
|---|---:|---|
| `entity_commands.rs` | 29 | `cmd_get_all_entities` `cmd_get_entity` `cmd_get_entities_by_type` `cmd_put_entity` `cmd_update_entity` `cmd_delete_entity` `cmd_count_entities_by_type` `cmd_clear_entities` `cmd_import_entities` `cmd_get_all_relations` `cmd_get_relations_by_entity` `cmd_put_relation` `cmd_update_relation` `cmd_delete_relation` `cmd_delete_relations_by_entity` `cmd_clear_relations` `cmd_import_relations` `cmd_kv_get` `cmd_kv_set` `cmd_kv_delete` `cmd_kv_get_all` `cmd_get_all_files` `cmd_get_file` `cmd_get_file_by_path` `cmd_get_files_by_entity` `cmd_put_file` `cmd_update_file` `cmd_delete_file` `cmd_get_file_content` |
| `fs_commands.rs` | 10 | `cmd_fs_write` `cmd_fs_read` `cmd_fs_list` `cmd_fs_delete` `cmd_fs_stat` `cmd_fs_mkdir` `cmd_fs_copy` `cmd_fs_copy_progress` `cmd_fs_rename` `cmd_open_in_explorer` |
| `algo_commands.rs` | 9 | `cmd_algo_force_layout` `cmd_algo_radial_layout` `cmd_algo_tree_layout` `cmd_algo_grid_layout` `cmd_algo_layout_unified` `cmd_algo_dijkstra_path` `cmd_algo_connected_components` `cmd_algo_pagerank` `cmd_algo_community_detection` |
| `capabilities.rs` | 5 | `cmd_capability_register` `cmd_capability_unregister` `cmd_capability_list` `cmd_capability_invoke` `cmd_capability_result` |
| `app_prefs.rs` | 4 | `cmd_theme_get` `cmd_theme_set` `cmd_product_prefs_get` `cmd_product_prefs_set` |
| `shell_bridge.rs` | 4 | `cmd_shell_open_external` `cmd_shell_bridge_report` `cmd_fix_workspace_acl` `cmd_shell_window_action` |
| `dsh_stream.rs` | 4 | `cmd_stream_open` `cmd_stream_send` `cmd_stream_end` `cmd_stream_cancel` |
| `lsp_commands.rs` | 4 | `cmd_lsp_detect` `cmd_lsp_start` `cmd_lsp_send` `cmd_lsp_stop` |
| `system.rs` | 3 | `cmd_notify` `cmd_autostart_is_enabled` `cmd_autostart_set_enabled` |
| `secure_store.rs` | 3 | `cmd_secure_store` `cmd_secure_load` `cmd_secure_delete` |
| `project_commands.rs` | 3 | `cmd_get_app_data_dir` `cmd_get_home_dir` `cmd_delete_project_db` |
| `office_commands.rs` | 2 | `cmd_office_available` `cmd_pptx_to_pdf` |
| `fs_watch_commands.rs` | 2 | `cmd_fs_watch_start` `cmd_fs_watch_stop` |
| `workspace_window.rs` | 2 | `cmd_shell_space_switch` `cmd_workspace_first_paint` |
| `tray.rs` | 2 | `cmd_tray_page_ready` `cmd_tray_set_recent_projects` |
| `font_scan.rs` | 2 | `cmd_font_scan_system` `cmd_font_read_file` |
| `dsh_sse.rs` | 2 | `cmd_sse_open` `cmd_sse_close` |
| `fs_usage.rs` | 2 | `cmd_fs_usage` `cmd_fs_copy_dir` |
| 其余 6 个文件 | 各 1 | `cmd_shell_popup_menu`（menu）· `cmd_fs_drives`（fs_drives）· `cmd_product_briefing`（product_briefing）· `cmd_dsh_workspace_list`（dsh_workspace）· `cmd_dsh_ready_state`（dsh_ready）· `cmd_fs_search`（fs_search） |

## 二、ACL 三方对账

| 集合 | 数量 |
|---|---:|
| Rust `fn cmd_*` 定义 | 99 |
| `generate_handler!` 注册 | 99 |
| 产品域 ACL（`permissions/worldsea-product.toml`） | **123** |
| 壳桥 ACL（`permissions/worldsea-shell.toml`） | 23 |
| 两窗 ACL 合计 distinct | **145** |
| 授权但 Rust 无实现 | **58** |
| 已注册但两窗 ACL 都不放行 | 11 |

### 58 条死 ACL 的来由

这 58 条是 `cmd_algo_*`（44 条：布局 / 图算法 / 几何 / CRDT / DXF / 地形 / 空间索引）+ `cmd_validate_*`（3）+ `cmd_check_references` + `cmd_run_diagnostics` + `cmd_migrate` 等。

**成因**：前端调用面整体切到 WASM 之后，ACL 白名单没有回收。`core/api/*.ts` 里那些 `cmd_algo_*` 字面量**全是死参数**——`backendCall(tauriCmd, ...)` 的第一个参数只用于拼日志字符串，实际执行走 WASM。

后果：白名单里 58 条永远不会被任何页面调用。它们的唯一作用是让 ACL 文件看起来比实际能力大 58 条。

### 11 条「有实现但无权」

`cmd_algo_{grid_layout,layout_unified,radial_layout,tree_layout}`（4 个布局算法，前端零调用）· `cmd_delete_project_db` · `cmd_get_app_data_dir` · `cmd_get_home_dir` · `cmd_lsp_stop` · `cmd_secure_{store,load,delete}`。

这些命令在页面上表现成「命令不存在」——因为 Tauri 的 ACL 拒绝不会走到命令实现。

## 三、ACL 机制要点

- 应用级 `permissions/` 目录一旦存在，Tauri 即对**所有**应用命令执行 ACL。
- 授权粒度 = 窗口 label（`main` / `workspace`）。
- `allow-*` 是 permission 文件，`capabilities/*.json` 把 permission 绑到窗口。
- 拒绝信息点名 `allowed on: [windows: "…"]`，这是排查「为什么这个窗口调不了」的第一手线索。

细节见 [与 dsh 的接缝](../../架构/dsh/与dsh的接缝.md) §一。

## 四、新增命令的完整流程

1. 在对应 `*_commands.rs` 写 `#[tauri::command] pub async fn cmd_xxx(...)`
2. 在 `lib.rs` 的 `generate_handler!` 加一行（漏了这一步命令永远调不到，且不报错）
3. 在 `permissions/worldsea-product.toml` 加 `"cmd_xxx"`（漏了这一步页面报「命令不存在」）
4. 前端经 `core/api/` 封装调用，不直接 `invoke`

**第 2 步与第 3 步都是静默失败**，没有编译期或启动期检查。`arch:check` 也不查这两处——这是当前门禁的盲区。

## 五、复现方式

```powershell
# 定义数
(Select-String -Path apps/tauri/src-tauri/src/*.rs -Pattern '^#\[tauri::command\]').Count

# 注册数（数 generate_handler! 块里的 ::cmd_）
# 见 scripts 或按 lib.rs:179-307 逐行数

# ACL 数
(Select-String -Path apps/tauri/src-tauri/permissions/*.toml -Pattern '"cmd_[a-z_0-9]+"').Count
```
