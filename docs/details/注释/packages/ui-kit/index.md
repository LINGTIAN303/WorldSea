# index.ts 详细注释

> 来源：`packages/ui-kit/src/index.ts`
> 说明：本文件为 ui-kit index 的「详细」层（why/how）归档。代码文件内仅保留简要注释并指向本文件。

## 包定位（FACADE）

@worldsea/ui-kit 是聚合门面包：把原生于本包的组件与下沉件统一 re-export，自身不含业务逻辑。分三段导出：

1. **Ws\* 纯 UI 原子组件**（WsIcon / TuiButton / WsEmpty / WsSpinner / FileIcon 等）——端分离迁移已完成，全部原生于 `./components/`（旧 `src/ui/` 目录已移除，2026-10-13 复核确认）；
2. **下沉件**：图标注册表（原根 `src/assets/iconRegistry.ts`）与 settings 模块共用工具/类型（原根 `src/ui/settings/utils.ts`）；
3. **App 级 UI 组件**（壳层 / 布局 / 导航 / 反馈）——已原生于 `./components/`，不再有"待迁移"状态。

## 2026-10-13 注释整改记录

原文件头的英文长注释块（"App-Level UI Components — Currently re-exported from src/ui/…"）描述的迁移已落地，属过期说明；已改写为一行中文现状描述，英文原文经 git 历史可找回。
