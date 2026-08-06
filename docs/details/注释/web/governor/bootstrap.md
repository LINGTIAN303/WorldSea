# bootstrap.ts 详细注释

> 来源：`apps/web/src/governor/bootstrap.ts`
> 说明：本文件为调控器启动配置内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-23 行）

```
/**
 * governor/bootstrap.ts — 调控器启动配置（Web 端迁移版）
 *
 * P3-W3 从根 src/governor/bootstrap.ts 迁移。P3-W4 已恢复：
 * - officialPluginsModule（官方插件分批迁入，详见 pluginLoaders）
 * - facetMigrationModule（core/FacetMigrator 已迁入 apps/web）
 * - fontBootstrapModule（composables/useFontBootstrap 已迁入 apps/web）
 *
 * 将 App.vue 的硬编码启动流程改造为声明式模块注册。
 *
 * 模块分层：
 * 1. critical（基础设施）：项目空间、数据库、事件总线、后端检测
 *    - 失败则中止 boot()，显示错误页
 * 2. normal（核心功能）：官方插件、关系初始化、Facet 迁移
 *    - 失败记录但继续
 * 3. lazy（延迟加载）：字体、记忆库、Agent、自动清理
 *    - 空闲时加载，失败静默
 *
 * 启动顺序保证：
 * - critical 全部成功后才进入 normal
 * - normal 全部完成后进入 lazy
 * - 每批内按依赖拓扑排序
 */
```

## 注释块 2（原文件第 32-43 行）

```
/**
 * 项目空间初始化。
 *
 * 原 App.vue 逻辑：
 *   const projectSwitcher = useProjectSwitcher()
 *   projectSwitcher.initialize().then(async () => {
 *     const entityStore = useEntityStore()
 *     entityStore.loadAll()
 *   })
 *
 * 必须在所有其他初始化之前完成。
 */
```

## 注释块 3（原文件第 131-141 行）

```
/**
 * 官方插件加载（P3-W4 首批 6 + 第二批 7 + 第三批 6 + 第四批 4，共 23 个）。
 *
 * 原 App.vue 逻辑（根 src/governor/bootstrap.ts 原版）：
 *   从 settingsStore 读取启用插件 → 并行动态 import → 顺序 activate → 尽早设置首屏视图。
 *
 * P3-W4 适配：
 * - 插件加载器改为「显式静态 import 映射」：Web 端不能用 @vite-ignore + 模板字符串，
 *   浏览器无法解析 '@/…' 别名；静态 import 让 Vite 构建时正确打包并做依赖分析。
 * - 仅加载已迁移的插件（MIGRATED_OFFICIAL_PLUGIN_IDS 与 loader 同步维护，随批次扩充）。
 */
```

## 注释块 4（原文件第 293-303 行）

```
/**
 * Facet 迁移。
 *
 * 原 App.vue 逻辑：
 *   import('./core/FacetMigrator').then(async ({ migrateWeaponApparelToItemFacet }) => {
 *     const report = await migrateWeaponApparelToItemFacet()
 *     if (!report.skipped) console.info('[App] Facet 迁移完成:', report)
 *   })
 *
 * P3-W4 恢复：core/FacetMigrator.ts 已迁入 apps/web/src/core/（仅依赖 entity-core）。
 */
```

## 注释块 5（原文件第 391-403 行）

```
/**
 * 字体预设加载。
 *
 * 原 App.vue 逻辑：
 *   const { bootstrap: fontBootstrap } = useFontBootstrap()
 *   if ('requestIdleCallback' in window) {
 *     requestIdleCallback(() => fontBootstrap())
 *   } else {
 *     setTimeout(() => fontBootstrap(), 200)
 *   }
 *
 * P3-W4 恢复：useFontBootstrap 为 @worldsmith/font-kit re-export（与根一致）。
 */
```
