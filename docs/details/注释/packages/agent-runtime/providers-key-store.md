# key-store.ts 详细注释文档（packages/agent-runtime/providers）

> 来源：`packages/agent-runtime/src/providers/key-store.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-17 行）

```
API Key 加密存储模块

双后端策略：
- Tauri 桌面端：优先使用系统 Keyring，写入后回读验证；
  若 Keyring 不可靠（Windows Credential Manager 兼容性问题），自动降级到 localStorage 加密存储。
- Web / 降级：使用 Web Crypto API (AES-GCM) 加密后存入 localStorage。
  加密密钥派生自设备指纹（userAgent + hostname），因此密钥在不同设备/域名下无法解密。

存储格式:
- Tauri Keyring: service = "com.worldsmith.app:{provider}", username = "api_keys"
- Tauri 降级 / Web: localStorage key = "worldsmith_ak_{provider}", value = Base64(iv || ciphertext)

使用流程:
  storeApiKey('openai', 'sk-xxx') → Tauri: Keyring(验证) / 降级: AES-GCM → localStorage
  loadApiKey('openai') → Tauri: Keyring / 降级: localStorage → 解密 → 返回明文
```
