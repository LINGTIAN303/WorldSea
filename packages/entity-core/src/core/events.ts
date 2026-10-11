/** 事件总线 + 生命周期事件（实体 CRUD/字段变更等跨模块通信基础设施），详细见 docs/details/注释/packages/entity-core/core/events.md */

/* ════════════════════════════════════════
   事件类型定义
   ════════════════════════════════════════ */

/** 实体创建事件 */
export interface EntityCreateEvent {
  entityId: string
  entityType: string
  properties: Record<string, unknown>
  source?: 'user' | 'agent' | 'import'
}

/** 实体更新事件（含变更前/后的字段） */
export interface EntityUpdateEvent {
  entityId: string
  entityType: string
  oldProperties: Record<string, unknown>
  newProperties: Record<string, unknown>
  changedFields: string[]
  source?: 'user' | 'agent' | 'import'
}

/** 实体删除事件 */
export interface EntityDeleteEvent {
  entityId: string
  entityType: string
  properties: Record<string, unknown>
  source?: 'user' | 'agent' | 'import'
}

/** 字段值变更事件 */
export interface FieldChangeEvent {
  entityId: string
  entityType: string
  field: string
  oldValue: unknown
  newValue: unknown
}

/** 关系创建事件 */
export interface RelationCreateEvent {
  relationId: string
  sourceId: string
  targetId: string
  type: string
  source?: 'user' | 'agent' | 'import'
}

/** 关系删除事件 */
export interface RelationDeleteEvent {
  relationId: string
  sourceId: string
  targetId: string
  type: string
  source?: 'user' | 'agent' | 'import'
}

export interface NameInputEvent {
  entityId: string
  text: string
}

export interface TextInputEvent {
  entityId: string
  field: string
  text: string
}

export interface BatchEditEvent {
  entityIds: string[]
  action: string
}

/** 所有可监听的事件映射 */
export interface EventMap {
  'entity:create': EntityCreateEvent
  'entity:update': EntityUpdateEvent
  'entity:delete': EntityDeleteEvent
  'field:change': FieldChangeEvent
  'relation:create': RelationCreateEvent
  'relation:delete': RelationDeleteEvent
  'name:input': NameInputEvent
  'text:input': TextInputEvent
  'batch:edit': BatchEditEvent
  [key: string]: unknown
}

export type EventName = string
export type EventHandler<T = unknown> = (data: T) => void | Promise<void>

export type Unsubscribe = () => void

const MAX_LISTENERS_PER_EVENT = 50

/* ════════════════════════════════════════
   EventBus
   ════════════════════════════════════════ */

class EventBus {
  private listeners = new Map<string, Set<EventHandler>>()
  private onceListeners = new Map<string, Set<EventHandler>>()

  private warnIfTooMany(name: string): void {
    const count = (this.listeners.get(name)?.size ?? 0) + (this.onceListeners.get(name)?.size ?? 0)
    if (count >= MAX_LISTENERS_PER_EVENT) {
      console.warn(
        `[EventBus] 事件 "${name}" 的监听器已超过 ${MAX_LISTENERS_PER_EVENT} 个（当前 ${count} 个），` +
        `可能存在内存泄漏。请确保在组件卸载时调用 on() 返回的取消函数。`
      )
    }
  }

  /**
   * 监听事件，返回取消订阅函数。
   * 组件应在 onBeforeUnmount 中调用返回的取消函数以避免泄漏。
   */
  on<K extends EventName>(name: K, handler: EventHandler<EventMap[K]>): Unsubscribe {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set())
    this.listeners.get(name)!.add(handler as EventHandler)
    this.warnIfTooMany(name)
    const self = this
    return () => { self.off(name, handler) }
  }

  /**
   * 一次性监听，返回取消订阅函数（可在触发前手动取消）。
   */
  once<K extends EventName>(name: K, handler: EventHandler<EventMap[K]>): Unsubscribe {
    if (!this.onceListeners.has(name)) this.onceListeners.set(name, new Set())
    this.onceListeners.get(name)!.add(handler as EventHandler)
    this.warnIfTooMany(name)
    const self = this
    return () => { self.off(name, handler) }
  }

  /**
   * 取消监听。
   * 如果需要更安全的生命周期绑定，推荐使用 on() 返回的取消函数。
   */
  off<K extends EventName>(name: K, handler: EventHandler<EventMap[K]>): void {
    this.listeners.get(name)?.delete(handler as EventHandler)
    this.onceListeners.get(name)?.delete(handler as EventHandler)
  }

  /**
   * 发射事件（异步执行所有处理器，但不阻塞调用方）
   * 处理器并行执行，错误不会影响其他处理器
   */
  emit<K extends EventName>(name: K, data: EventMap[K]): void {
    const handlers = this.listeners.get(name)
    const onceHandlers = this.onceListeners.get(name)
    if (onceHandlers) {
      this.onceListeners.delete(name)
    }
    if (!handlers?.size && !onceHandlers?.size) return

    // 异步执行所有处理器，不阻塞调用方
    Promise.resolve().then(() => {
      if (handlers) {
        for (const handler of handlers) {
          try { Promise.resolve(handler(data)).catch(e => console.error(`[EventBus] ${String(name)}:`, e)) } catch (e) { console.error(`[EventBus] ${String(name)}:`, e) }
        }
      }
      if (onceHandlers) {
        for (const handler of onceHandlers) {
          try { Promise.resolve(handler(data)).catch(e => console.error(`[EventBus] ${String(name)}:`, e)) } catch (e) { console.error(`[EventBus] ${String(name)}:`, e) }
        }
      }
    })
  }

  /**
   * 清除所有监听器
   */
  clear(): void {
    this.listeners.clear()
    this.onceListeners.clear()
  }

  /**
   * 获取指定事件的监听器数量（调试用）
   */
  listenerCount(name: string): number {
    return (this.listeners.get(name)?.size ?? 0) + (this.onceListeners.get(name)?.size ?? 0)
  }
}

/** 全局单例 */
export const eventBus = new EventBus()
