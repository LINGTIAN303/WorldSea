# smart-fetch.ts 详细注释文档（packages/agent-runtime/utils）

> 来源：`packages/agent-runtime/src/utils/smart-fetch.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 53-60 行）

```
统一网络请求函数

- Tauri 模式：通过 plugin:http|fetch 发起请求，绕过浏览器 CORS 限制
- Web 模式：使用浏览器原生 fetch()

返回与标准 Response 兼容的 SmartResponse 对象。
```
