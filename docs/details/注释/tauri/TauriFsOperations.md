# TauriFsOperations.ts 详细注释文档（tauri）

> 来源：`apps/tauri/src/memory-archive/adapters/TauriFsOperations.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 6-19 行）

TauriFsOperations - FsOperations 接口的 Tauri 环境实现

封装项目自定义的 cmd_fs_* Rust 命令，为 memory-archive 框架提供文件系统操作。
Web 环境下所有方法抛出错误（memory-archive 需要 Tauri 文件系统支持）。

底层命令映射：
- readFile  → cmd_fs_read
- writeFile → cmd_fs_write（createDirs=true）
- mkdir     → cmd_fs_mkdir（recursive=true）
- remove    → cmd_fs_delete（recursive=true）
- exists    → cmd_fs_stat（检查 exists 字段）
- readDir   → cmd_fs_list（recursive=false，返回 name 列表）
