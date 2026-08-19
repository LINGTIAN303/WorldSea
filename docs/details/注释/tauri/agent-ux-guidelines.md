# Agent UX 视觉指引（union-polar·克制派）

> 来源：Agent 前端 UI/UX 工作主文档（阶段0 审美基准，2026-08-19）
> 关联：[usePlanRust.md](usePlanRust.md)、[useSubagentRust.md](useSubagentRust.md)、编排面板各阶段
> 定位：本项目 **Agent 能力前端呈现层** 的统一视觉宪法——本文档是每个阶段（编排面板/输出渲染/配置统一/全审计）的审美判据。

## 一、总基调

**综合克制派 · 弱提示分级显隐**，基于现有设计令牌体系，不重构只升级。

- **底子**：沿用现有 theme.css 令牌（紫 accent、零硬编码色、token spacing/radius）、弱提示语言
- **目标**：让 Agent 的"能力"被一线用户**清晰、克制、可读**地投影出来，而非堆满控制台
- **判据**：任何新增 UI 先问一句——"这个信息现在有必要让用户看到吗？"没有就收起来。

## 二、五条设计原则

### 1. 克制底子不重构
- 沿用现有令牌（--accent/--surface/--border/--text-* 等）与弱化语言（disabled 0.5、hover 弱强化、--press-scale）
- 求**一致性** > 求翻新；新面板与既有面板（SubAgentView / PlanPanel / MemoryPanel）同构
- 禁止引入非令牌色值、渐变、3D 重效

### 2. 数据透传清晰
- Agent 的编排/推理/诊断能力用**精准小图表/紧凑列表**呈现（ToT 树、Router 流、耗时/token、评分）
- 图表克制：只做数据所需的最小可视，不喧宾夺主；优先图表/徽标/标签，非大号 KPI 堆砌
- 数值用 `--text-code` + 表格数字，单位随值

### 3. 叙事可读
- Agent 的推理链/反思/评审/工具调用以**可读叙事 + 时间线/卡片**投影，弱化"控制台感"
- 时间叙事克制：今天/昨天/今天仅 HH:mm（沿用 format.ts）；日志用 formatClock

### 4. 桌面质感精修
- 层次/留白/阴影/微交互向 Linear 式专业工具看齐
- 卡片圆角 `--radius-card`、紧凑块 `--radius`；hover 反馈统一（列表=背景标题 accent、卡片=边框 accent）
- 微交互克制：`--press-scale`、`--dur-pulse`，尊重 prefers-reduced-motion

### 5. 分级显隐（决定默认密度）
- **默认只显示当下最有用的信息**；次要信息折叠/收纳
- 机制优先：`<details>` 折叠 / hover-reveal（可交互小钮）/ 溢出菜单（“…”）/ 分级 tab
- 追加原则：新面板容量 = 只放高频操作，低频进“更多”；符合"弱提示优于强提示"

## 三、面板语言（编排面板统一模板）

编排 4 模式（ToT/GoT/Router/Supervisor）轻量面板 tab 遵循统一结构：

```
[视图头部：模式名 + 运行/停止]
[输入/配置区：精简表单 · 折叠收起]
[运行区：执行状态 + 进度]
[结果区：可视化投影（树/流/评分）+ 结果叙事]
```

- 头/配置/运行/结果四段式，与 PlanPanel / SubAgentView 同构
- 运行态：按钮 `:loading`（不降透明度 cursor:progress）、禁用态 `--disabled-opacity`
- 空态：统一 TuiEmpty（icon/fill/弱色徽标）
- 错误/成功：danger-soft / success-soft 弱底+边框 box（batch56 基准）

## 四、校验清单（每个 Agent UI 交付前逐条过）

- [ ] 沿用令牌，零硬编码色/非令牌圆角，无渐变 3D
- [ ] 默认密度：只显当下有用信息，次要已折叠/收纳（分级显隐）
- [ ] 交互弱提示：hover/focus-visible/按压反馈统一，尊重 reduced-motion
- [ ] 数据用紧凑图表/徽标，非大号 KPI 堆砌
- [ ] 时间叙事统一（format.ts），错误/成功 box 统一
- [ ] 图标用 WsIcon（已注册名，非注册降级为文本即弃用）
- [ ] 可访问性：aria、键盘（Enter+Space）、label for/id、role 语义
- [ ] 与既有面板（SubAgentView/PlanPanel）视觉断层检查

## 五、章节速览（供索引）

| 章节 | 主题 |
|---|---|
| 一 | 总基调（综合克制派） |
| 二 | 五条设计原则 |
| 三 | 面板语言模板 |
| 四 | 交付校验清单 |