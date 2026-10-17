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
# 全局规则（2026-10-18 版 · 三合一）

> 完整规则 = 单一真源（用户级 `RULES.md`，跨项目）；项目内切分副本见 `.opencode/rules/`：
> `collaboration-communication.md` / `delivery-quality.md` / `session-resilience.md`（由真源生成，勿单独改）。
> 本块只列**不可省**的判据，细节读上述文件。

## 一、协作与沟通（判据）

- **判定线**：改动是否改变「用户操作路径」——改变（增删步骤 / 改跳转 / 换交互 / 改信息层级）→ 先确认；只改呈现（配色 / 间距 / 字号 / 图标 / 文案 / 动效）→ 可自主；触及既定设计偏好时先确认。
- 复杂功能：先查外部资料 → 讨论细节 + 计划 → 确认后执行。小任务：先熟悉相关代码再动。
- 交付前套 7 点清单；**不自动修复未要求的问题**——列风险点 + 建议，由用户决定。
- 提问：模糊时用 AskUserQuestion 给具体选项；多决策合并一次问。
- 回复：结论先行 + 关键技术细节；专业术语首次附中文。
- **绘图**：禁 ASCII 图与手工拼形状 / 箭头；用 Mermaid / Graphviz / PlantUML 等结构化语法（先描述结构，再渲染）。

## 二、交付与质量（标准）

**7 点清单**：硬性 ① 无 BUG / ② 无冲突逻辑 / ⑤ 链路无断裂；软性 ③ 一致性 / ④ 无隐患 / ⑥ 架构稳固 / ⑦ 落地质量（给依据）；末尾列风险点。

**文档（2026-10-18 优化）**

- 引用：正文用 `[文件](相对路径)`；代码切片 / 目录清单用 `路径/文件`。
- **plans**：命名 `YYYY-MM-DD-主题.md`；新文档用 frontmatter `status:`；状态＝待启动 / 执行中 / 临时 / 已完成；**已完成同批 `git mv` 到 `plans/已完成/`**，不留 plans 根。
- **details**：架构 → 前后端 → 注释；代码内只写 what（一行 + 文档相对路径），why/how 进 `details/注释/`；改代码影响注释 → 同批同步文档；另允许**专题目录**（成套探究，须带 README，如 `端分离/`）——层次层与专题不混用。
- **index**：每条 = 状态 + 标题 + 摘要 + 链接；**新条目摘要 ≤ 200 字**（门禁 / 提交号 / 行数等过程细节归正文；存量归档不追溯压缩）；**单文件 > 200KB 或 > 150 行即分卷**（主索引只留在途，归档卷放已完成 + 变更日志）；文档变更同批更新索引；批量变更后跑 `node scripts/check-doc-links.mjs`（断链 0 / 绝对路径 0）。
- **索引状态词表**：`待启动` / `执行中` / `临时` / `已完成` / `现行` / `历史留档` / `作废` / `—`（不得自造同义词，「交接」归「临时」）。
- **misc**：三类收容——`生成物/`（工具可再生成，可随时删）· `留档/`（作废 / 历史参考，只读）· 素材与数据（技能源 / 设计稿）；证据截图统一 `details/截图/`。

**项目约束**：Rust + Tauri 2 + Vue 3 + SQLite · 禁 emoji 图标（Naive UI / SVG）· 相对路径 · 禁硬编码 APIKey · **PowerShell 7（pwsh）** · **UTF-8 无 BOM** · 标识符英文 / 注释中文 · 等行为下优先扁平紧凑短代码 · 无旧数据迁移负担。

## 三、会话韧性（纪律）

- 记忆：阶段完成 / 关键架构决策 / 用户说「记住这个」→ 立即更新记忆；上下文不足 → 主动更新 + 请求压缩。
- 阈值：75%（≈450K/600K）预警，85%（≈510K/600K）请求压缩；压缩前存记忆 + 进度 + 阶段结论；压缩后按记忆恢复。
- 5 策略：分阶段聚焦 / 记忆兜底 / TodoWrite 跟踪 / 外部资料即时查 / 用户只做决策。
- 部署：WorldSea 不上线、不推送（部署流程仅 MemoryCenter 项目适用）。
<!-- global-rules end -->
