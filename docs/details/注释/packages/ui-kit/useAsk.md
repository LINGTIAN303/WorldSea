# useAsk — 提问面板（批量问题协议）

> 源文件：`packages/ui-kit/src/composables/useAsk.ts`

## 定位

与确认弹窗（useConfirm）同位置弹出（对话区底部输入栏上方），供「Agent 主动提问」场景使用（模型经 `ask_user_question` 工具发起，Rust 侧广播族事件 `InteractionRequested`〔user_input 型〕，通道 `agent:interaction:{session_id}`；面板由统一监听器 kind 分派唤起）。

## 协议（对齐 dsh `ask_user_question`）

见 [02-dsh提问工具设计基线.md §五](../../../../plans/2026-09-18-对话区对齐dsh/02-dsh提问工具设计基线.md)：

- 批量 `questions[]`：一次请求承载整批问题，逐题作答（进度 N/M；支持上一步/下一步）
- 每题**稳定 id 随答案原样回显**；单选「点选即前进」、多选 toggle + 继续
- 「自定义」：单选下覆盖 selected（清空选项）、多选下为补充
- 「跳过」= 空答案（`{id, selected: []}`）；「取消」= 整体拒绝（resolve null → ASK_DENIED）
- 提交前未答且未跳过 → 拦截（`incomplete` 提示，不可前进）

## 单面板约束（同 dsh composer 独占）

同刻只持有一个提问面板；kernel 侧对提问工具强制串行（同批多 ask 不会并行弹出），前端对后到请求按「新请求接管」处理。
