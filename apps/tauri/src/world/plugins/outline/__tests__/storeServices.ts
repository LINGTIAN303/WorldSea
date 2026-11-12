/**
 * outline 测试专用：把 `world.*` 服务表登记为「转发到真实 store」。
 *
 * 为什么需要：outline 的组件已改为经树服务取数（批次 G），而这些 spec 不起树
 * （直接 `setActivePinia` + fake-indexeddb 走真实 store 集成）。不登记服务表的话，
 * 组件挂载即抛「服务未就绪」。
 *
 * 转发而非替身：保持原测试「真实 store + fake-indexeddb」的集成语义，也让
 * `vi.spyOn(store, 'update')` 仍能捕获到经服务转发的调用。
 *
 * 用法：
 * ```ts
 * beforeEach(() => { setActivePinia(pinia = createPinia()); installStoreServices() })
 * afterEach(() => clearWorldServiceTable())
 * ```
 */
import { useEntityStore, useRelationStore } from '@worldsea/entity-core'

import { registerWorldServiceTable } from '../../../service-registry'

/** 登记实体 + 关系两个服务，均转发到当前活动 pinia 的 store。 */
export function installStoreServices(): void {
  registerWorldServiceTable({
    'world.entities': {
      list: () => useEntityStore().entities,
      get: (id: string) => useEntityStore().entityMap.get(id),
      byType: (type: string) => useEntityStore().entities.filter(e => e.type === type),
      add: (...args: Parameters<ReturnType<typeof useEntityStore>['add']>) =>
        useEntityStore().add(...args),
      update: (...args: Parameters<ReturnType<typeof useEntityStore>['update']>) =>
        useEntityStore().update(...args),
      remove: (...args: Parameters<ReturnType<typeof useEntityStore>['remove']>) =>
        useEntityStore().remove(...args),
      reload: () => useEntityStore().loadAll(),
      loadByType: (type: string) => useEntityStore().loadByType(type),
      getAll: () => useEntityStore().getAllEntities(),
    },
    'world.relations': {
      list: () => useRelationStore().relations,
      byEntity: (entityId: string) =>
        useRelationStore().relations.filter(r => r.sourceId === entityId || r.targetId === entityId),
      loadByEntity: (entityId: string) => useRelationStore().loadByEntity(entityId),
      add: (...args: Parameters<ReturnType<typeof useRelationStore>['add']>) =>
        useRelationStore().add(...args),
      update: (...args: Parameters<ReturnType<typeof useRelationStore>['update']>) =>
        useRelationStore().update(...args),
      remove: (...args: Parameters<ReturnType<typeof useRelationStore>['remove']>) =>
        useRelationStore().remove(...args),
      reload: () => useRelationStore().loadAll(),
      getAll: () => useRelationStore().getAllRelations(),
    },
  })
}
