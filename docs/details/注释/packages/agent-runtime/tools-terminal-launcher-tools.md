# terminal-launcher-tools.ts 详细注释文档（packages/agent-runtime/tools）

> 来源：`packages/agent-runtime/src/tools/terminal-launcher-tools.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 6-19 行）

```
终端启动器工具集

智能检测运行模式（Tauri 桌面 / Web 应用），按正确模式调用终端能力。
支持自动启动 worldsea-server（Web 模式下的命令执行后端）。

工具：
- detect_terminal_mode: 检测当前运行模式
- start_server: 启动/检测 worldsea-server 服务
- launch_terminal: 启动终端并可选执行命令
- launch_terminal_script: 启动终端执行脚本文件

Web 模式下的命令执行依赖 worldsea-server，工具链会自动检测并启动服务。
```
