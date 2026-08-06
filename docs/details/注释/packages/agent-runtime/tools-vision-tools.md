# vision-tools.ts 详细注释文档（packages/agent-runtime/tools）

> 来源：`packages/agent-runtime/src/tools/vision-tools.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-13 行）

```
视觉分析工具集

提供跨供应商的图片视觉分析能力。当主模型不支持视觉时，
可通过 vision_analyze 工具调用单独的视觉子模型来分析图片。

支持三套 API 格式：
1. OpenAI 兼容格式 (chat/completions + image_url)
2. Anthropic 原生格式 (v1/messages + image source)
3. Google Gemini 格式 (models/{model}:generateContent + inline_data)

图片通过 image-store 内存缓存临时共享，有 30 分钟 TTL。
```
