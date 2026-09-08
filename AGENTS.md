<!-- memory-center-agents begin -->
# MemoryCenter 记忆协议（项目级硬性规则）

> 本文件由 install_rules 自动写入，被 IDE 自动读取注入 LLM system prompt。
> 完整规则详见 `.opencode/rules/memory-center-archive.md`（或 `.catpaw/rules/`、`.trae/rules/`）。

## session_id 约定（必须遵守）

```
{客户端前缀}-{项目名}-{日期}
```

**客户端前缀**：
- CatPaw: `catpaw`
- Trae: `trae`
- Claude Code: `claudecode`
- Cursor: `cursor`
- OpenCode: `opencode`

**示例**：
- `catpaw-myapp-20260706`
- `trae-MemoryCenter-20260706`
- `claudecode-worldsea-20260706`
- `opencode-worldsea-20260709`

> 一个 session_id 对应一个独立的记忆空间。同会话内复用同一 session_id，
> 切换项目或日期时换新 session_id。
>
> **禁止使用 `项目名-session` 这种格式**（如 `worldsea-session`），
> 会导致 retrieve 找不到记忆。若不确定用哪个 session_id，先调 `MemoryCenter_prompt` 工具
> 查看可用 session 列表，或询问用户。

## 记忆协议（Agent 必须遵守，无需用户提示主动执行）

### 1. 会话开始：调 prompt 获取历史记忆
每个新会话的第一次回复前，必须先调用 `MemoryCenter_prompt(session_id)`。
返回的摘要拼接到 system prompt。若返回空列表，说明该 session 无历史记忆。

### 2. 上下文接近阈值：主动调 archive 归档
触发条件（满足任一）：
- 对话超过 20 轮（用户消息 + LLM 回复算 1 轮）
- 包含大量代码 / 长文档 / 多次工具调用
- 感觉"上下文开始变重"、"前面说过但记不清细节"
- 每 30 轮兜底归档一次

### 3. 用户提到过去事件：先调 semantic_search
当用户消息中出现"之前"、"上次"、"还记得"等指代词时，先用用户原话作为 query
检索相关记忆，把检索结果作为上下文再回复。

### 4. project_memory 反向写入
完成开发阶段/关键决策/风险点时，调 `MemoryCenter_update_project_memory` 更新 project_memory.md。
拿到 full_content 后用 Write 工具写入对应客户端的 memory 文件夹。

### 5. 上下文被压缩后：执行压缩后行为协议
当系统消息中出现 `This session continues a previous conversation that lost its context.` 时，
立即执行 4 步强制流程（详见 rules/memory-center-archive.md）：
1. 归档压缩前未持久化的轮次
2. 调 prompt 拉取 MemoryCenter 一手记忆
3. 交叉校准 Summary 第8章节 Current Work
4. 执行 Next Step 决策协议

## 工具触发规则速查表

| 时机 | 工具 |
|------|------|
| 会话第一次回复前 | `MemoryCenter_prompt` |
| 上下文接近阈值 | `MemoryCenter_archive` |
| 用户提到过去事件 | `MemoryCenter_semantic_search` |
| 需要查特定记忆 | `MemoryCenter_retrieve` |
| 需要查所有记忆列表 | `MemoryCenter_summaries` |
| 完成开发阶段/关键决策 | `MemoryCenter_update_project_memory` |
| 上下文被压缩后 | `MemoryCenter_archive` + `MemoryCenter_prompt` |
| 周级去重合并 | `MemoryCenter_compaction` period="weekly" |
| 月级评分淘汰 | `MemoryCenter_compaction` period="monthly" |
<!-- memory-center-agents end -->

<!-- global-rules begin -->
# 全局规则（协作与沟通 / 交付与质量 / 会话韧性）

> 适用范围：每次会话常驻。完整规则文件见 `.opencode/rules/`（`collaboration-communication.md` / `delivery-quality.md` / `session-resilience.md`，`.catpaw/rules/` 有同步副本）。
> 本块为三份规则的可执行摘要，冲突时以 `.opencode/rules/` 完整文件为准。

## 一、协作与沟通

### 用户画像
- AI/Agent 领域：熟悉，可深入讨论架构与原理
- 编程：懂原理（架构/数据流/设计模式），但具体实现语法/公式有理解门槛
- 英文：较差，使用翻译器辅助（代码注释/文档优先中文，专业术语附中文说明）
- 学习风格：原理层面能跟上，实现细节需要逐步引导

### 工作流偏好
- 复杂功能：先搜索外部最新资料确保无偏差 → 讨论细节并制定计划 → 确认后再执行
- 小任务：先熟悉相关内容再执行，不放过细节
- 交付前：按 7 点检查清单自检，通过后直接交付；发现潜在问题列出风险点让我决定，不自动修复
- 规划时：优先考虑选择技能、插件作为辅助，减少规划负担

### 决策边界
**原则**：用户体验设计与实现细节的判定线 = **改动是否改变"用户操作路径"**。
- 改变路径（增删步骤、改跳转、换交互、改信息层级）→ UX 设计，需确认
- 只改呈现（配色、间距、字号、图标、文案、动效时长）→ 实现细节，可自主
- 例外：触及已明确设定的设计偏好时，即使只改样式也先确认

**需要确认的决策**：架构变更（crate/模块重组）、数据模型设计（表/字段）、用户体验设计（流程/交互）、新增依赖（Cargo/npm）、影响部署的变更（环境变量/配置文件）
**可自主决策的**：实现细节（命名/函数拆分/代码组织）、工具选择（已有依赖内）、错误处理方式、注释与文档风格

### 提问偏好
- 描述模糊时优先用选择题（AskUserQuestion）而非开放式提问；选项要具体，避免"其他"成为主要选择
- 涉及多个决策时合并到一次提问，减少打断
- 用户没回答说明没注意到，可再次提问；仍然没回答说明不在电脑前

### 回复风格
- 默认中等详细度：结论先行 + 关键技术细节
- 说"简洁点"：只给结论和关键决策点；说"详细点"：可展开技术细节、原理解释、代码注释
- 代码示例：关键行加中文注释，复杂逻辑附原理说明
- 专业术语：首次出现附中文说明（如 "ToolBus（工具总线）"）

## 二、交付与质量规范

### 7 点检查清单（交付前自检）
分两层：**硬性项**（客观可验证，必须全过）① 无 BUG、② 无冲突逻辑、⑤ 链路无断裂；**软性项**（主观判断，给依据）③ 一致性、④ 无隐患、⑥ 架构稳固、⑦ 落地质量。
自检模板：
```
- [ ] ① 无明显BUG（硬）
- [ ] ② 无冲突逻辑（硬）
- [ ] ③ 一致性（软·依据：___）
- [ ] ④ 无隐患（软·依据：___）
- [ ] ⑤ 链路无断裂（硬）
- [ ] ⑥ 架构稳固（软·依据：___）
- [ ] ⑦ 落地质量（软·依据：___）
- [ ] 风险点：___（需用户决定）
```
交付策略：自检通过后直接交付；发现潜在问题列出风险点 + 建议方案让我决定是否处理；不自动修复未要求的问题。

### 文档内容
- **引用形式**：正文引用其他文档用形式 2（可点击 + 简洁）：`[文件](路径)`；代码切片/目录清单等"需要准确扫描路径"的场合用形式 1：`路径/文件`
- **docs/ 目录体系**：分四类：计划 plans / 项目详情 details / 索引 index / 其他 misc
  - plans 按"方向递进"分层：大体方向 → 具体方向 → 过程方向；文档带状态且可流转：待启动 / 执行中 / 临时 / 已完成
  - details 按"抽象层次"递进：架构（系统级）→ 前后端（实现级）→ 注释（细节级）；注释分层：代码内「简要」+ `details/注释/`「详细」；判定线：「做什么」（what）留代码内就地，「为什么/整体」（why/how）进文档；代码变更影响注释含义时同步更新对应文档
  - index 是摘要层：每条含 状态 + 标题 + 摘要（结论）+ 链接；文档变更必须同步索引，避免读到过期摘要

### 项目约束
- 技术栈：Rust + Axum + Vue 3 + SQLite，单二进制部署
- 禁止使用 emoji 表情当图标，用 Naive UI 图标或 SVG
- 编码中的路径采用相对路径，禁用绝对路径
- 禁止硬编码 APIKey 及提交并推送到 GitHub 仓库中

## 三、会话韧性

### 记忆管理
- 全局记忆采用 MemoryCenter；每个开发阶段完成时更新 project_memory.md；关键架构决策时立即更新；用户说"记住这个"时立即更新；上下文窗口不足时主动更新记忆 + 请求压缩

### 上下文管理
- 上下文窗口 200k 为最佳效果区段；约 75%（≈150K/200K）预警；约 85%（≈170K/200K）主动请求压缩
- 压缩前必做：更新 project_memory.md + 保留 TodoWrite 进度 + 记录本阶段结论
- 压缩后：用户确认后，以记忆 + TodoWrite 恢复最佳状态继续
- 针对 200K 窗口的 5 条策略：① 分阶段讨论，每次只聚焦一个主题；② 记忆文档兜底，压缩后也能找回；③ TodoWrite 跟踪进度；④ 外部资料即时查（WebSearch），不占用户脑容量；⑤ 用户只需做决策，Agent 负责信息收集与整理

### 部署流程
> ⚠️ 仅限 MemoryCenter 项目（worldsea 项目不上线、不推送）。
> 服务器/宝塔/SSH 凭证与密钥路径见 `.catpaw/rules/project-deployment.md`（已 gitignore，不入库），此处不重复明文。

- 部署机制：`git push production main` → 服务器 post-receive hook → 构建 frontend (vite build) + 编译 Rust 后端 + 重启服务，无需手动 SSH/SFTP
- 标准部署命令（本地与远端历史一致时）：`git add . && git commit -m "feat(xxx): 描述" && git push production main`
- 历史分叉时（push 报 "Updates were rejected because the remote contains work"）：优先 `git fetch production main && git rebase production/main && git push production main`；备选 format-patch 打包 → scp 上传 → 服务器 `git am` 应用 → `git push origin main --force` 触发 hook
- 禁止方案：`git push --force` + 大文件 bundle/scp（SSH 易被 reset，且不触发 hook）
- 部署失败排查：`Connection reset by peer` / `Broken pipe` → 网络问题或服务器负载过高，等 30s 重试；`! [remote rejected]` → post-receive hook 执行失败，SSH 查看 journalctl 或部署日志；部署后 SSH 执行 `systemctl status <项目名>` 确认 active running，或浏览器访问确认功能正常
- 为避免加重 fail2ban，SSH/部署命令失败后不要重复尝试，先排查原因
<!-- global-rules end -->
