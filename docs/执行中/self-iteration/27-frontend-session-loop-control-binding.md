## 迭代主题 27：前端绑定会话创建 loop_control（手动命令与自动驱动共享单实例）

> 迭代主题 26（决策点 81）在 Rust 端打通了"命令层注册表复用会话内建 `Arc<LoopController>`"，但把"手动命令与自动驱动读数一致"的验证留作桌面端待办，且前端 `create` 尚未把 `sessionId` 透传给 `cmd_loop_control_create`。本轮补齐前端链路：`create` 支持 `sessionId` 绑定，并在会话创建后自动绑定 loop_control，使共享单实例在桌面端真正落地。

### 决策点 82：前端 `create` 增 `sessionId` 参数，透传给 `cmd_loop_control_create`
**选择**：`useLoopControlRust.ts` 的 `create(taskId, config?, sessionId?)` 新增可选 `sessionId`，`invoke('cmd_loop_control_create', { taskId, config, sessionId })` 透传。有 `sessionId` → Rust 端 `register_session_loop_control` 复用会话内建控制器（`config` 被忽略，以内建配置为准）；无 `sessionId` → 保留"独立创建控制器（手动轨）"原路径。
**理由**：后端已支持 `session_id` 绑定（迭代 26），前端契约同步补齐即可让调用方按需选择"共享内建"或"独立手动"两种创建方式；`config` 文档注明在绑定会话时被忽略，避免调用方误以为自定义配置生效。

### 决策点 83：会话创建后自动绑定 loop_control（`lc_{sessionId}`）
**选择**：`App.vue`（Tauri 桌面端对话入口）在 `onNewSession` / `onMounted` 创建会话后调用 `bindSessionLoopControl(info.id)`，以 `lc_{sessionId}` 为 taskId 绑定 loop_control。绑定失败仅 `console.warn` 弱提示，不阻塞会话（`already_exists` 等可忽略）。
**理由**：桌面端是"自动驱动 + 手动命令"双驱动的真实运行环境，会话创建即绑定共享控制器，使 AgentLoop 每轮 `inc_turns`（自动）与前端 `getStatus`/`recordTurn`（手动）读取同一份状态，从而验证读数一致；弱提示符合"功能受限用弱提示"的既有偏好，且绑定是旁路增强，不应影响会话主链路。