# useMcpConnections.ts 详细注释

> 来源：`packages/shared-composables/src/agent/useMcpConnections.ts`
> 说明：本文件为 useMcpConnections 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。
> 更新（2026-08-30）：H6-③ MCP 配置化拍板后整体重写，历史 localStorage 镜像/内置默认连接设计见文末「已废弃设计」。

## 注释块 1（模块头：配置化后的职责边界）

````
/**
 * 配置唯一事实源 = Rust 全局配置文件 mcp.json（H6-③ 配置化拍板 2026-08-30：
 * `<app_data>/worldsea/mcp.json`，用户与 Agent 均可编辑，官方预设全部移除）。
 * 本层只维护 Vue 展示缓存与交互编排——不再有 localStorage 镜像与内置默认
 * 连接；启动重连由 Rust auto_connect_all 直接读配置文件完成，前端 ensureLoaded 只取状态。
 */
````

设计决策（why）：
- **单一事实源**：配置文件是唯一持久层。旧实现 localStorage（`agent_mcp_connections`）与 Rust mcp.db 双写必然漂移（同配置两处真相），配置化拍板后收敛为文件一处。
- **ensureLoaded 不再代连**：旧实现前端从 localStorage 读配置逐个 connect——Rust 侧 auto_connect_all 已在启动时完成同样的事，前端代连会造成双重连接竞争。
- **toggle 语义修正**：旧实现「禁用 = removeMCPConnection（删除配置）」——禁用却丢配置是语义错误。新实现：禁用 = 保存 enabled=false + 断开（配置保留）；启用 = connect（连接即持久化），连接失败时回写禁用态保持文件与状态一致。
- **getAgent 注入式解耦**：shared-composables 不硬依赖具体端实现，Tauri 端注入 useAgentRust、Web 端注入 useWebAgent。

## 使用方式

```ts
// Tauri 端（SpaceAgentSettingsPanel 消费）
const { connections, addConnection, removeConnection, toggleConnection, ensureLoaded } =
  useMcpConnections({ getAgent: () => useAgentRust() })
```

## 已废弃设计（2026-08-30 前的历史，勿参考）

- `STORAGE_KEY = 'agent_mcp_connections'` localStorage 镜像层——废弃（双真相源）。
- `DEFAULT_MCP_CONNECTIONS`（内置 Firecrawl Keyless 预设）与 `mergeWithDefaults` 合并策略——废弃（拍板：MCP 不再拥有官方预设，全部配置走 mcp.json 文件）。
- 「删除默认配置时写入 enabled=false 占位防合并回归」——随 DEFAULT_MCP_CONNECTIONS 一并废弃（无默认配置即无回归问题）。
