# 自迭代决策记录（Self-Iteration Decisions）

> 创建日期：2026-08-05
> status: 历史档案（2026-10-10 整理标注：2026-08-06 切分 29 分片后未再追加）
> 目的：用户放开权限，允许 AI 自行对项目自迭代。凡遇到"拿捏不住、需要拍板"的选点，**不打断用户确认**，在此记录我选择的方案与理由，备查可回溯。

## 切分说明（2026-08-06）

原文档 920 行、23 个迭代主题、72 个决策点，单文件过长——另一会话的 Agent 每次读取都会触发上下文压缩。已按迭代主题切分为独立分片，存于 [self-iteration/](self-iteration/) 目录。**本文件只是索引，不承载正文**：需要某主题详情时按下表链接**按需读取单个分片**，勿全量读取目录。

- 新增迭代：在 `self-iteration/` 新建 `NN-xxx.md` 续写，并在下表追加一行。
- 决策点编号全局递增（当前到 84），跨分片不重复。

## 索引（29 个迭代主题 / 决策点 1-86）

| # | 迭代主题 | 决策点 | 摘要 | 分片 |
|---|---------|--------|------|------|
| 1 | 子 Agent 编排接入主对话循环 | 1-7 | delegate 工具 + 实例池接入 AgentLoop，规格跨会话共享 | [01](self-iteration/01-sub-agent-orchestration.md) |
| 2 | 子 Agent 规格管理 UI | 8-13 | 规格注册/删除、3 个 Tauri 命令、SubAgentView.vue | [02](self-iteration/02-subagent-spec-ui.md) |
| 3 | 子 Agent 工具白名单 | 14-20 | WhitelistToolBus 包装器实现工具隔离 + 3 组 e2e 实测 | [03](self-iteration/03-tools-whitelist.md) |
| 4 | 委派过程可视化 | 21-26 | 事件广播 + 120s 超时 + 重建时上下文迁移 | [04](self-iteration/04-delegation-visualization.md) |
| 5 | 长任务终态闭环单测 | 27 | fail_task / retry_task / clear_retry_marker 补测，零生产改动 | [05](self-iteration/05-longtask-terminal-closure.md) |
| 6 | 委派超时后实例状态清理 | 28 | reset_after_timeout 复位流式 + 裁剪残缺消息，而非 abort() | [06](self-iteration/06-timeout-state-cleanup.md) |
| 7 | 委派深度限制 | 29-30 | task_local 跟踪调用栈深度，默认 3 层防递归膨胀 | [07](self-iteration/07-delegate-depth-limit.md) |
| 8 | 前端流式输出 + 自动滚动 | 31-35 | 复用 Stream* 事件 + EMITTER_REGISTRY + 智能滚动 | [08](self-iteration/08-streaming-typewriter.md) |
| 9 | 委派状态展示 UI 增强 | 36-38 | 分组统计徽标 + setInterval 实时耗时 + 长错误展开 | [09](self-iteration/09-delegation-ui-enhance.md) |
| 10 | 规格 SQLite 持久化 | 39-43 | JSON 整条存储 + SubAgentSpecStore trait + 写穿缓存 | [10](self-iteration/10-sqlite-persistence.md) |
| 11 | 规格导出 / 导入 | 44-46 | JSON 数组备份迁移，textarea 弹窗，零新增依赖 | [11](self-iteration/11-export-import.md) |
| 12 | 预设规格模板 | 47 | templates.ts 前端多模板预填，不写死后端 | [12](self-iteration/12-spec-templates.md) |
| 13 | 规格后端校验 | 48 | 公开 validate_subagent_spec，注册/导入统一校验 | [13](self-iteration/13-backend-validation.md) |
| 14 | 单条规格复制 | 49 | 列表项复制按钮写入完整 JSON | [14](self-iteration/14-single-copy.md) |
| 15 | 子 Agent 实例管理 | 50-53 | list/clear 实例，按会话隔离实例池 | [15](self-iteration/15-instance-management.md) |
| 16 | 思考级别选择器 | 54-55 | 对话头部 `<select>` 选深度模式，流式期间禁用 | [16](self-iteration/16-thinking-level.md) |
| 17 | 侧边栏会话管理 UI | 56-58 | 新建/删除会话，删除按钮悬浮显现防误触 | [17](self-iteration/17-session-management.md) |
| 18 | 输入/控制区补齐 | 59-60 | 生成中发送↔停止切换 + 清空对话按钮 | [18](self-iteration/18-control-buttons.md) |
| 19 | 模型配置弹窗 | 61-63 | ModelSettingsDialog 三模式热切换，API Key 存 localStorage | [19](self-iteration/19-model-settings.md) |
| 20 | 中途引导（steer） | 64-65 | 生成中输入引导 + 引导/停止双按钮，弱提示 | [20](self-iteration/20-steer.md) |
| 21 | 对话运行轮次展示 | 66-67 | getState 轮询展示「第 N 轮」，不写回 messages | [21](self-iteration/21-iteration-display.md) |
| 22 | 上下文窗口压缩 | 68-69 | trim_context 保留最近 8 条，全链路实现 | [22](self-iteration/22-trim-context.md) |
| 23 | Loop Control / Long Task 命令层恢复 | 70-72 | 端分离迁移断裂，18 命令重建于 agent-commands | [23](self-iteration/23-loop-control-long-task.md) |
| 24 | LoopController 接入 AgentLoop | 73-76 | 内建自动控制闭环：限流停止 + 重试/限流事件自动 emit | [24](self-iteration/24-loopcontroller-agentloop.md) |
| 25 | Recovered 事件接入内建 emit | 77 | 告警锁存态边沿检测（is_alerted true→false）→ 恢复自动上报 | [25](self-iteration/25-recovered-builtin-emit.md) |
| 26 | 内建与命令层 LoopController 共享单实例 | 78-81 | 命令层注册表复用 AgentLoop 内建 Arc，消除"自动 vs 手动"双轨状态不一致 | [26](self-iteration/26-shared-loop-controller.md) |
| 27 | 前端绑定会话创建 loop_control | 82-83 | create 透传 sessionId，App.vue 会话创建后以 lc_{sessionId} 绑定共享控制器 | [27](self-iteration/27-frontend-session-loop-control-binding.md) |
| 28 | 宽松配置默认不误停 | 84 | 单元回归测试守护默认宽松配置不误停正常收敛流，部分替代桌面实测 | [28](self-iteration/28-lenient-config-no-false-stop.md) |
| 29 | Loop Control 实时状态展示 UI | 85-86 | 只读状态条展示计数器+事件徽标，纯前端织入既有 composable，零后端改动 | [29](self-iteration/29-loop-control-status-ui.md) |