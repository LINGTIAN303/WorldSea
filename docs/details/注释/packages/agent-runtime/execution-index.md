# index.ts 详细注释文档（packages/agent-runtime/execution）

> 来源：`packages/agent-runtime/src/execution/index.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-19 行）

```
# ExecutionAdapter 工厂注册模式

端无关的执行适配器入口。不直接 import 任何端特定 adapter，
通过 registerExecutionAdapterFactory 由各端入口注入实现。

端注册示例：
```typescript
// CLI 端（apps/cli/src/bootstrap.ts）
registerExecutionAdapterFactory({
  createNodeAdapter: () => new NodeExecutionAdapter(),
})

// Web 端（apps/web/src/bootstrap.ts）
registerExecutionAdapterFactory({
  createWsAdapter: (config) => new WebSocketExecutionAdapter(config),
})
```
```

## 注释块 2（原文件第 44-53 行）

```
获取 WebSocket 服务器 URL

优先级（从高到低）：
1. localStorage.ws_server_url — 用户手动覆盖（运行时）
2. import.meta.env.VITE_CLI_SERVE_URL — 构建时配置（Vite 环境变量）
3. ws://localhost:3100 — 默认值（与 CLI serve 默认端口一致）

注意：import.meta.env 在非 Vite 环境（如 Node）可能未定义，需安全访问。
```

## 注释块 3（原文件第 137-146 行）

```
创建执行适配器（端无关入口）

优先级由注册的工厂决定：
1. Node.js 环境 → createNodeAdapter
2. Tauri 桌面 → createTauriAdapter
3. 浏览器 → createWsAdapter

@throws {Error} 如果未注册工厂或当前环境无匹配的适配器
```
