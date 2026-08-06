# coding-agent-tools.ts 详细注释文档（packages/agent-runtime/tools）

> 来源：`packages/agent-runtime/src/tools/coding-agent-tools.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-20 行）

```
编码 Agent 标准工具集

对齐主流编码 Agent（Claude Code / Cline / Cursor）的工具接口，
在现有底层工具上包装一层标准接口，供 Agent 直接使用。

映射关系：
- read_file    ← fs_read（增加 offset/limit 支持）
- write_file   ← fs_write
- edit_file    ← 新增（精确行级编辑，old_string→new_string）
- search_files ← fs_search + content_search
- list_directory ← fs_list
- execute_command ← 保留
- shell_session ← 合并 detect_shells/shell_session_create/exec/input/destroy/list
- web_search   ← 保留
- web_fetch    ← 保留

旧工具（fs_read/fs_write/fs_list/...）保留但不再暴露给 Agent，
仅通过此标准接口访问。
```
