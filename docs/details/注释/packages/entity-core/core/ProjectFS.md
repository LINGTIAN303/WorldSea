# ProjectFS.ts 详细注释

> 来源：`packages/entity-core/src/core/ProjectFS.ts`
> 说明：本文件为 ProjectFS 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-27 行）

> **2026-09-25 注**：目录树中的 `modules/`（自定义模块定义）条目已删——「自定义模块」随本批整体剪除（见 [剪自定义模块批计划](../../../../../plans/已完成/2026-09-25-剪自定义模块批计划.md)），导出不再输出该目录。

> **2026-10-23 注**（产品域首页收口）：`.worldsea/` 下新增可选的 `home.json`（首页 profile），导出/导入已纳入白名单：导出从当前项目实体根读取，导入写入新项目实体根；文件缺失时两侧都静默跳过，不阻塞主体。该文件是可选文件，`ProjectFS` 的格式版本不变。导入时 `switchProject` 返回 false 即中止（避免数据写进旧项目）；**已知边界**：应用启动链未调用 `registerProjectSwitcherApi`，导入流程当前不可达（导出已接，pre-existing）；写入 home.json 后广播 `ws-home-profile-changed`，让已挂载的首页资料 store 重读（切换项目早于本步写入，首轮 load 可能读到空资料）。**2026-10-23 优化批**：`WorldSeaPack` 新增 `home-profile` 序列化分区（`core/serializers/HomeProfileSerializer.ts`），从当前项目收集、按 overwrite/merge 写回并广播同一事件；导入导出弹窗默认包含该分区。项目文件夹导入（`importProjectFromDir`）仍因 `registerProjectSwitcherApi` 未注册不可达。

````
/**
 * ProjectFS — 项目文件系统导出/导入
 *
 * Phase 1: 将 IndexedDB 中的项目数据导出为本地文件夹结构，
 * 以及从文件夹结构导入恢复到 IndexedDB。
 *
 * 目录结构规范：
 * ```
 * MyProject/                     # 项目根目录
 * ├── project.json               # 项目元数据
 * ├── entities/                  # 实体数据，按类型分目录
 * │   ├── character/
 * │   │   ├── hero-001.json      # 单个实体一个文件
 * │   │   └── villain-002.json
 * │   └── region/
 * │       └── kingdom-001.json
 * ├── relations/
 * │   └── _index.json            # 所有关系集中存储
 * ├── settings/
 * │   └── plugins.json           # 插件开关（当前仅此一项，视图排序/配置未落盘）
 * ├── icons/                     # 自定义图标文件（id.ext，可选）
 * ├── settings/
 * │   ├── plugins.json
 * │   ├── icon-assets.json       # 自定义图标登记（可选）
 * │   └── icon-overrides.json    # 项目图标覆盖（可选）
 * └── .worldsea/                 # 内部元数据
 *     └── cache.json              # 版本/校验信息
 * ```
 */
````
