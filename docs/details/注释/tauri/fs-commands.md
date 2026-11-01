# fs_commands — 文件系统命令层的定位与目录口径裁定

> 源文件：`apps/tauri/src-tauri/src/fs_commands.rs`

## 定位（兜底防线）

本命令层为**应用层直通**——消费方（项目存储 FileStorageBackend、WorkspacePanel、WorkdirSelect）
路径来自可信前端，故不做 workdir 边界；Agent 工具侧的边界（workdir 词法边界 + 受保护目录写守卫）
在 TS 工具层 `packages/agent-runtime/src/tools/workspace-boundary.ts` 执行。
本层仅保留敏感目录写防护（sensitive_dir_reason / ensure_write_allowed）作为全链路最后兜底。

已知限制：shell 类工具的内容级写入无法词法拦截（记录于方案文档）。

## 目录口径裁定（用户 2026-09-25）

保留宽口径——产品域 `cmd_fs_*` **不设 workdir 边界**（仅拒 `~/.ssh` / `~/.gnupg` / 系统目录）：
本地创作工具语义（导出/导入可写任意位置）+ 前端可信；dsh 侧仍是**严沙箱**（只放行 cwd + tmp）。
两套写规则**并存是显式设计**，非缺陷。

## 相邻命令：fs_drives.rs（盘符枚举）

> 源文件：`apps/tauri/src-tauri/src/fs_drives.rs`

`cmd_fs_drives` 单独成文件而非并入 `fs_commands.rs`，原因有二：`fs_commands.rs` 已超架构门禁的 400 行上限（基线冻结 515 行，只禁增长）；盘符枚举是「根导航」语义，与「路径内操作」的命令族不同层。

只读命令，不参与 `ensure_write_allowed` 的写守卫。Windows 走 `GetLogicalDrives`（位掩码）+ `GetDriveTypeW`（介质类型），非 Windows 返回单一根 `/`。返回路径恒正斜杠，与 `cmd_fs_list` 输出口径一致。

消费方只有自绘文件选择器的左侧轨；ACL 在 `permissions/worldsea-product.toml`（工作台窗）。
