# channel_order — Channel 投递全序修复

> 源文件：`apps/tauri/src-tauri/src/channel_order.rs`

## 背景（真机取证）

证据链见 `.workbuddy/memory/2026-09-30.md` §十六 与项目记忆 `worldsea-channel-order-facts`。
Tauri Channel 对 <8192B 的 JSON 走同步 `webview.eval`（有序），对 ≥8192B 走异步
`plugin:__TAURI_CHANNEL__|fetch`（`invoke(...).then(runCallback)`）——两条路径混用时**不保序**：
长会话的 428KB 开局快照会被紧随其后的 240B 流式小帧超车。dsh 客户端流协议要求全序
（assistant 帧 revision 连续）；乱序触发其流拆毁修复，修复流又撞上「快照 vs 实时帧」竞态 →
会话事件流终止（`session assistant stream skipped revision 1`）→ 前端冻结（后台照常；
切会话/刷新才「接上」）。

## 修法

装官方扩展点 `Builder::channel_interceptor`，让**全部** JSON 消息走与 Tauri 小载荷分支
同形的同步 eval 直投；Raw 交回默认（本壳未用 Raw 通道）。代价：大消息（快照级，每流一次）不再
享受异步 fetch —— 实测反而更快（同窗口 fetch 比 eval 迟 ~27ms）；正常小帧路径零改动。

## 反证开关

`WORLDSEA_NO_CHANNEL_ORDER_FIX=1` → 不接管（交回默认双路径；「流式进行中刷新页面」确定性复现应再红）。
