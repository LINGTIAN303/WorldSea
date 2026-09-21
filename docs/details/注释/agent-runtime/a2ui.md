# a2ui.rs 详细注释文档（agent-runtime）

> 来源：`crates/agent-runtime/src/a2ui.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-26 行）

# A2UI（Agent-to-UI）数据结构

阶段 P2 高级能力新增。本模块定义 Rust 端 A2UI 平行类型，
与 TS 端 `worldsea-agent/src/bridge-types.ts` 的 `A2UIMessage` 联合类型对齐。

## 设计原则
- **平行类型**：在 `agent-runtime` 内独立定义，不依赖 `worldsea-core`，
  避免违反架构分层约束（`agent-runtime` 是底层运行时，不应依赖业务核心层）
- **序列化对齐**：使用 `#[serde(rename_all = "camelCase")]` 确保序列化结果
  与 TS 端 camelCase 字段一致，前端可零映射消费
- **变体表示**：用单一结构体 + `Option` 字段表示 TS 端的 discriminated union
  （与 `worldsea-core/src/retrofit/a2ui.rs` 风格一致），
  序列化时仅非 None 字段出现，匹配 TS 联合类型的"恰好一个变体"语义

## 与 TS 端的映射
| Rust 字段              | TS A2UIMessage 变体        |
|------------------------|----------------------------|
| `create_surface`      | `{ createSurface: {...} }` |
| `update_components`   | `{ updateComponents: {} }` |
| `update_data_model`   | `{ updateDataModel: {} }`  |
| `delete_surface`      | `{ deleteSurface: {...} }` |

## 使用场景（2026-09-17 现状）
- 桥工具（`ui_*` / 实体工具）执行中经前端 `ctx.emitA2UI` → `cmd_agent_emit_a2ui` →
  `OrchestratorEvent::A2UIEvent`（携带 `A2UIMessage`）广播到会话事件总线
- Tauri emitter 转发前端通道 `agent:event:a2ui:{session_id}`；同一条事件另经动作段臂
  缓冲 → AgentEnd 收口落 `meta.action_events`（画布回源数据源，见 2026-09-17 画布回源计划）
- 前端监听该通道更新 `a2uiSurfaces` 状态，由 `A2UIRenderer.vue` 渲染

> 历史注记：本段原描述「`AgentEvent::A2UI` 变体 → `AgentEventPayload::A2UI`」为接线前设计；
> 2026-09-17 A2UI 端到端接线（活路径走 `OrchestratorEvent::A2UIEvent`）后，
> `AgentEvent::A2UI` 死变体已清理（D6/D7 纪律延续）。

---

## 注释块 2（原文件第 32-49 行）

A2UI 组件定义（对应 TS `A2UIComponent`）

组件是画布上的可渲染单元，通过 `component` 字段指定类型
（如 "Text"、"Button"、"EntityCard"、"Column"、"Row" 等）。

# 字段说明
- `id`：组件唯一标识（在同一 surface 内唯一）
- `component`：组件类型名（对应前端注册的组件名）
- `children`：子组件 ID 列表（用于 Container 类组件如 Column/Row/List）
- `text`：文本内容（Text/Button 等组件使用）
- `variant`：变体样式（如 "primary"、"danger"、"h3"、"body"）
- `label`：标签（StatBar/TextField 等使用）
- `value`：值（StatBar/Slider 等使用，可为数字或对象）
- `min` / `max`：数值范围（Slider/StatBar 使用）
- `data_path`：数据绑定路径（如 "/entity/name"）
- `action`：点击动作（Button 使用，含事件名与数据）
- `actions`：动作列表（EntityCard 等多操作组件使用）
- `tags`：标签数据（TagGroup 使用，可为数组或数据绑定对象）

---

## 注释块 3（原文件第 113-122 行）

A2UI 消息（对应 TS `A2UIMessage` 联合类型）

采用单一结构体 + `Option` 字段表示 TS 端的 discriminated union。
序列化时仅非 None 字段出现，匹配 TS 联合类型的"恰好一个变体"语义。

# 变体优先级
当多个字段同时为 Some 时，前端按以下顺序处理：
`create_surface` > `update_components` > `update_data_model` > `delete_surface`

实际使用中，单条消息只应设置一个变体字段。
