# main.ts 详细注释

> 来源：`apps/web/src/main.ts`
> 说明：本文件为 Web 端入口内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-13 行）

```
/**
 * Web 端入口（Phase 3 — 端分离业务 UI 迁入 · 第一批：骨架启动链路）
 *
 * 端分离策略：
 * - 硬编码 WASM 后端（移除 getBackendType 运行时检测）
 * - 通过 /api/* 代理连接 CLI serve（LLM、文件、Python 微服务）
 * - WASM 算法降级（当 CLI serve 不可用时）
 *
 * 迁移批次标注：
 * - P3-W1 ✅ 设计令牌 + boot 组件（Splash/BootError）+ 轻量共享壳
 * - P3-W2 ✅ Shell 布局（MenuBar/SidebarV2/WsConfirmDialog/Companion/AppMessageHandler + modules/store + useProjectSwitcher）
 * - P3-W3 ⏳ 核心页面（AgentSpace/实体视图/插件面板）+ governor + 官方插件 + 业务弹窗
 */
```
