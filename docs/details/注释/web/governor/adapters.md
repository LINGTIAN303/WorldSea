# adapters.ts 详细注释

> 来源：`apps/web/src/governor/adapters.ts`
> 说明：本文件为 governor 适配器内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-21 行）

```
/**
 * governor/adapters.ts — 适配器（Web 端迁移版）
 *
 * P3-W3 从根 src/governor/adapters.ts 迁移，路径调整：
 * - 官方插件引用 '../plugins/official/...' → '@/plugins/official/...'（apps/web 内）
 *
 * 将现有的 OFFICIAL_PLUGINS 和 ModuleManifest 转换为统一的 ModuleDescriptor。
 *
 * 适配策略：
 * 1. OFFICIAL_PLUGINS → ModuleDescriptor
 *    - requires/hosts 根据插件特性推断（drawing/tactical-board 需 canvas）
 *    - priority 统一为 'normal'（官方插件）
 *    - defaultActive 从 OfficialPluginEntry.defaultActive 映射
 *    - activate 函数动态 import 插件模块后调用
 *
 * 2. ModuleManifest（自定义模块）→ ModuleDescriptor
 *    - requires 留空（自定义模块不依赖环境能力）
 *    - priority 为 'normal'
 *    - activate 调用现有 moduleRegistry.activateModule 逻辑
 *    - 保留 dependencies 和 semver 检查
 */
```

## 注释块 2（原文件第 30-46 行）

```
/**
 * 需要特定能力的插件映射表。
 *
 * 根据插件实际代码分析推断：
 * - Canvas 2D：drawing/mindmap/tactical-board/timeline/inspiration + 8 个 useTreeCanvas 插件
 * - GPU/WebGL：graph/module-builder（Sigma.js）
 * - Web Worker：graph（布局计算）
 * - WASM：tactical-board（战术引擎，有 JS 回退）
 * - Tauri 原生算法：mindmap（Dijkstra/PageRank/社区检测/布局）
 * - LLM Provider：manuscript/mindmap/workflow（AI 续写/建议/编排）
 * - 网络：inspiration（从 URL 提取颜色）
 * - heavy-cpu：tactical-board（寻路/态势感知）
 *
 * 注意：tactical-board 和 mindmap 都有完整的 JS 降级实现，
 * WASM/Tauri 不可用时自动降级，因此不声明 'wasm'/'tauri'/'native-algo' 为必需能力。
 * 'heavy-cpu' 仅为标识，不阻止激活（所有环境都有此能力）。
 */
```

## 注释块 3（原文件第 80-90 行）

```
/**
 * 将单个 OfficialPluginEntry 转换为 ModuleDescriptor。
 *
 * @param entry 官方插件清单条目
 * @returns 模块描述符
 *
 * 注意：version 设为 '0.0.0' 占位符。真实版本在插件 manifest 中，
 * 但 descriptor 在动态 import 前创建，无法同步获取。
 * 官方插件无相互依赖，版本号不参与依赖检查，不影响功能。
 * TODO: 后续可在 activate 内部读取 manifest.version 并通过 registry 更新。
 */
```

## 注释块 4（原文件第 168-177 行）

```
/**
 * 将自定义模块的 ModuleManifest 转换为 ModuleDescriptor。
 *
 * 自定义模块通过 moduleRegistry.activateModule 注册实体类型/关系/视图，
 * 这里包装为 GovernorAPI 兼容的 activate 函数。
 *
 * @param manifest 模块清单
 * @param active 是否当前激活（来自 moduleStore）
 * @returns 模块描述符
 */
```
