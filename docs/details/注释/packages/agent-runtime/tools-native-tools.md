# native-tools.ts 详细注释文档（packages/agent-runtime/tools）

> 来源：`packages/agent-runtime/src/tools/native-tools.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-16 行）

```
桌面原生能力工具集

通过 Tauri 插件提供桌面原生能力，Web 模式下降级或提示不可用。

工具:
- dialog_open: 打开文件选择对话框
- dialog_save: 打开保存文件对话框
- dialog_message: 显示消息对话框
- dialog_ask: 显示询问对话框（是/否）
- clipboard_read: 读取剪贴板内容
- clipboard_write: 写入剪贴板
- open_url: 打开 URL 或本地文件
- notify: 发送系统通知
- native_fetch: Tauri 原生 HTTP 请求（绕过 CORS）
```
