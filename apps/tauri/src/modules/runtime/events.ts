/**
 * events — 事件总线（re-export）
 *
 * Phase 8a：实现已下沉到 @worldsea/entity-core/core/events.ts
 * 本文件保留向后兼容的 re-export。
 */
export {
  eventBus,
  type EntityCreateEvent,
  type EntityUpdateEvent,
  type EntityDeleteEvent,
  type FieldChangeEvent,
  type RelationCreateEvent,
  type RelationDeleteEvent,
  type NameInputEvent,
  type TextInputEvent,
  type BatchEditEvent,
  type EventMap,
  type EventName,
  type EventHandler,
  type Unsubscribe,
} from '@worldsea/entity-core'
