# video-gen-tools.ts 详细注释文档（packages/agent-runtime/tools）

> 来源：`packages/agent-runtime/src/tools/video-gen-tools.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 22-33 行）

```
供应商协议配置

每家视频 API 的协议各不相同，这里统一抽象为：
- submitPath: 提交任务的 Vite 代理路径
- pollPath: 轮询状态的 Vite 代理路径（含 {taskId} 占位符）
- extraSubmitHeaders: 提交时额外需要的请求头
- buildBody: 根据统一参数构建供应商特定的请求体
- extractTaskId: 从提交响应中提取任务 ID
- extractStatus: 从轮询响应中提取状态字符串
- extractVideoUrl: 从轮询响应中提取视频 URL
```
