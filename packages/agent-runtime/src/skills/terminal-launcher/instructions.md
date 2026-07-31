# 终端启动器技能

你已获得智能终端启动能力，可以根据当前运行模式正确调用终端。

## 核心原则：模式感知，绝不混淆

本技能的核心是**模式感知**。系统存在两种运行模式，你必须清楚区分：

| 模式 | 标识 | 终端调用方式 |
|------|------|-------------|
| **Tauri 桌面模式** | `tauri` | 通过本地 PTY 直接调用，无需额外服务 |
| **Web 应用模式** | `web` | 通过 WebSocket 连接 worldsmith-server 代理调用 |

## 工具一览

| 工具 | 用途 | 使用时机 |
|------|------|---------|
| `detect_terminal_mode` | 检测当前模式和服务状态 | 执行任何终端操作前必须先调用 |
| `start_server` | 启动 worldsmith-server | 仅 Web 模式，当终端不可用时 |
| `launch_terminal` | 执行单条命令 | 简单的 shell 命令 |
| `launch_terminal_script` | 执行多行脚本 | 复杂命令序列、多行脚本 |

## 工作流程

### 第一步：检测模式（必须）

在执行任何终端操作之前，**必须先调用 `detect_terminal_mode`**：

```
detect_terminal_mode() → { mode, modeLabel, available, serverHealthy, wsUrl, hint }
```

- `mode`: "tauri" 或 "web"
- `available`: 终端是否可用
- `serverHealthy`: worldsmith-server 是否健康（仅 Web 模式有意义）
- `hint`: 下一步操作建议

### 第二步：根据模式分支处理

#### Tauri 桌面模式（mode === "tauri"）

终端直接可用，跳到第三步执行命令。

#### Web 应用模式（mode === "web"）

**如果 `available === true`**：终端可用，跳到第三步。

**如果 `available === false`**：需要先启动 worldsmith-server：

1. 调用 `start_server` 启动服务：
   ```
   start_server(project_root="项目根目录路径")
   ```

2. **`start_server` 在 Web 模式下的行为**：
   - 先检查服务是否已在运行（健康检查），如果已运行则直接重建连接
   - 如果服务未运行，调用 Vite 开发服务器的 `/api/launch-server` 端点，由 Vite（Node.js 进程）代为 spawn worldsmith-server
   - 如果 Vite 代理也失败，返回 `manualSteps` 对象，包含用户可执行的启动命令

3. 如果 `start_server` 返回 `ok: true`，再次调用 `detect_terminal_mode` 确认终端可用

4. 如果 `start_server` 返回 `ok: false` 且包含 `manualSteps`：
   - **将 `manualSteps` 中的命令展示给用户**，请用户在系统终端中执行
   - 一键启动脚本：`start-worldsmith.bat`（Windows）或 `start-worldsmith.sh`（Unix）
   - 手动启动：`cd <项目目录>\worldsmith-server && npm run dev`
   - 用户执行后，再次调用 `detect_terminal_mode` 确认终端可用

### 第三步：执行命令（带模式确认）

调用 `launch_terminal` 或 `launch_terminal_script` 时，**必须传入 `mode_hint` 参数**：

```
launch_terminal(command="...", mode_hint="tauri" 或 "web")
launch_terminal_script(script="...", mode_hint="tauri" 或 "web")
```

- 如果 `mode_hint` 与实际模式不匹配，工具会返回错误并拒绝执行
- 这是一种安全机制，防止你在错误的模式假设下操作

### 第四步：处理结果

根据返回的 `mode` 字段确认执行环境，向用户说明结果。

## start_server 工具详解

`start_server` 在不同模式下有不同行为：

### Tauri 桌面模式
- 通过 `child_process.spawn` 直接拉起 server 进程
- 启动后自动健康检查 + 重建 WebSocket 连接
- 如果失败，提示用户手动执行

### Web 应用模式（浏览器环境）
- **浏览器本身无法 spawn 进程**，这是浏览器安全限制
- 但 Vite 开发服务器是 Node.js 进程，可以代为执行
- `start_server` 会按以下优先级尝试：
  1. 健康检查 → 如果 server 已运行，直接重建连接
  2. Vite 代理 → 调用 `/api/launch-server`，由 Vite 服务器 spawn worldsmith-server 进程
  3. 返回 `manualSteps` → 提供用户可执行的命令和脚本路径（仅当 Vite 代理也失败时）

### Vite 代理启动机制

Web 模式下，`start_server` 调用 `fetch('/api/launch-server', {method: 'POST'})`：
- Vite 开发服务器（localhost:5173）是 Node.js 进程，可以 spawn 子进程
- 它会启动 `worldsmith-server` 的 `npm run dev`
- 启动后自动进行健康检查（最多等待 20 秒）
- 返回启动结果给 AI Agent

这意味着：**在 Web 开发模式下，AI Agent 可以自动启动 worldsmith-server，无需用户手动操作！**

## 安全规范

1. **禁止危险命令**：不执行 rm -rf /、del /s /q、sudo、format、dd、shutdown、reboot 等
2. **先检测再执行**：永远不要跳过 detect_terminal_mode 步骤
3. **模式确认**：launch_terminal / launch_terminal_script 的 mode_hint 必须与检测结果一致
4. **错误处理**：如果终端不可用，Web 模式下先尝试 start_server，失败再向用户说明

## 完整流程图

```
detect_terminal_mode
       │
       ├── mode=tauri ──→ available? ──→ yes ──→ launch_terminal(mode_hint="tauri")
       │                              └─ no ──→ start_server(本地 child_process)
       │                                           ├── ok ──→ launch_terminal
       │                                           └── fail ──→ 提示手动启动
       │
       └── mode=web ──→ available? ──→ yes ──→ launch_terminal(mode_hint="web")
                                     └─ no ──→ start_server
                                                  │
                                                  ├── server已运行 ──→ 重建连接 → launch_terminal
                                                  ├── Vite代理启动 ──→ launch_terminal
                                                  └── 返回manualSteps ──→ 请用户执行
                                                                            ├── start-worldsmith.bat
                                                                            └── cd worldsmith-server && npm run dev
```
