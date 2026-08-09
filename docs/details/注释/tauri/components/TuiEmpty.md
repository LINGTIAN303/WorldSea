# TuiEmpty 统一空状态组件

## 职责

提供全端统一的空状态视觉语言：**图标徽标 + 主文案 + 副文案**。

视觉基准取自对话区空状态（App.vue `.empty-mark`）：`bg-muted` 圆角徽标承载弱化 accent 色图标、`text-secondary` 主标题、`text-muted` 副说明。避免每个视图各自手写空状态导致的样式漂移。

## Props

| prop | 类型 | 默认 | 说明 |
|------|------|------|------|
| icon | string | 'info' | 图标名（WsIcon 集合） |
| title | string | '' | 主文案 |
| hint | string | '' | 副文案（纯文本） |
| compact | boolean | false | 窄面板/列表内嵌：徽标 40px、间距收紧 |
| fill | boolean | false | 独立内容区空状态：flex:1 垂直居中撑满父容器 |

默认插槽用于需要富文本（如 `<code>`）的副文案场景，此时 hint prop 置空。

## 使用约定

- **独立内容区**（终端输出区、记忆列表区）用默认模式 + `fill`，父容器需 `display:flex; flex-direction:column` 使 fill 生效。
- **窄面板内嵌**（会话列表面板、终端会话面板）用 `compact`，不设 fill。
- **内嵌区块**（如子 Agent 实例区）不建议套用——区块空状态加图标反而喧宾夺主，保留文字即可。

## 接入点（2026-08-07 批次26）

- TerminalView：输出区「等待命令」+ 会话面板「暂无会话」
- MemoryPanel：无会话 / 加载中 / 暂无记忆 / 加载详情中 四态
- SubAgentView：规格列表「暂无子 Agent 规格」（含 code 富文本走插槽）
- SessionList：暂无会话 / 无匹配结果

## 决策记录

- 图标用 `stroke-width 1.5`（弱于默认 1.7），空状态是"安静"的，图标线条不宜过重。
- 徽标不用 accent 色底（强提示），用 `bg-muted` 底 + `--accent-soft-border` 图标色（弱提示），与对话区一致。
- 对话区自身空状态含建议 chips，保持原结构不迁移；TuiEmpty 只覆盖无交互元素的纯空状态。
