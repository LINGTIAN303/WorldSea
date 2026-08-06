# useImageResolver.ts 详细注释

> 来源：`packages/entity-core/src/composables/useImageResolver.ts`
> 说明：本文件为 useImageResolver 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 37-54 行）

````
/**
 * 通用"图片解析"重试管理：把 IDB 与 appendBlock 之间的写库时差封装成
 * "事件优先 + 退避兜底"的两段式循环。
 *
 * 用法：
 *   const resolver = useImageResolver({ subscribe: l => onFilePersisted(l) })
 *   watch(src, () => {
 *     resolver.run(async (v) => {
 *       if (v !== resolver.getVersion()) return false
 *       const data = await store.get(...)
 *       if (v !== resolver.getVersion()) return false
 *       if (!data) return false
 *       state.value = data
 *       return true
 *     })
 *   }, { immediate: true })
 *   onUnmounted(() => resolver.cancel())
 */
````
