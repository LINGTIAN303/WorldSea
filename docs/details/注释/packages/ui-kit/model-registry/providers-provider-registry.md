# provider-registry.ts 详细注释文档（packages/agent-runtime/providers）

> 来源：`packages/agent-runtime/src/providers/provider-registry.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-12 行）

```
供应商统一注册表 (Provider Manifest Registry)

所有云端供应商的基础信息集中定义在此，
其他模块（bridge、UI、代理、端点解析等）统一从此注册表读取，
新增供应商只需在此添加一条 manifest 即可。

设计原则：
- 单一数据源：供应商的 base URL、图标、compat 配置等只定义一次
- 声明式：每个供应商是一个纯数据对象，逻辑由消费方统一处理
- 可扩展：新供应商只需 push 一条 manifest，无需修改其他文件
```
