# agent-descriptor.ts 详细注释

> 来源：`packages/agent-core/src/agent-descriptor.ts`
> 说明：本文件为 agent-core 库描述符内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-10 行）

```
/**
 * @worldsmith/agent-core 库描述符
 *
 * 遵循项目 LibraryDescriptor 约定，供 InternalChainRegistry 注册。
 * 当前阶段 agent-core 作为纯类型/接口库，不提供 CapabilityDeclaration，
 * 工具能力由 worldsmith-agent 的各工具文件注册。
 *
 * 后续 Phase 2 工具去重后，编码工具集的 CapabilityDeclaration
 * 将迁移至此描述符中。
 */
```
