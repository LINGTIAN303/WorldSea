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
