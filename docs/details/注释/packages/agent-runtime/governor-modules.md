# governor-modules.ts 详细注释文档（packages/agent-runtime）

> 来源：`packages/agent-runtime/src/governor-modules.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-19 行）

```
worldsea-agent/src/governor-modules.ts — Agent 包模块描述符

将 Agent 包的 toolbus/skills/tools 系统声明为 governor 模块，
由 createAgentGovernor() 在 boot() 时按 priority + 依赖拓扑自动激活。

模块分层：
1. critical（基础设施）：ToolBus、内部能力链、工具元数据
   - 失败则中止 boot()，抛出错误
2. normal（核心功能）：Skills 注册表 + 各类工具集
   - 失败记录但继续
3. lazy（延迟加载）：MCP、群聊系统
   - 空闲时加载，失败静默

与 apps/web/src/governor/bootstrap.ts 的区别：
- 不依赖 Vue/Pinia（Agent 包可在 terminal 环境运行）
- 工具注册保持静态 import（governor 只编排初始化顺序与环境验证）
- Web 端和 CLI 端共用同一套模块描述符，通过 requires/hosts 过滤
```

## 注释块 2（原文件第 53-63 行）

```
内部能力链注册。

注册 entity-core/plugin-sdk/canvas-engine 的能力描述符到 InternalChainRegistry。
ui-kit 延迟注册以避免循环依赖。

注册实际在 agent.ts（Web 端）模块加载时完成，此处仅验证。
CLI 端使用空的 cliRegistry，跳过验证。

依赖 toolbus 模块完成。
```

## 注释块 3（原文件第 85-94 行）

```
工具元数据注册中心。

初始化 tool-meta-registry，为所有工具（含旧工具名）提供元数据查询。

注册实际在 agent.ts（Web 端）或 cli-agent.ts（CLI 端）模块加载时完成，
此处仅验证工具元数据可查询。

依赖 internal-registry 完成（工具列表需要先组装）。
```
