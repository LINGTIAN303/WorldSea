# useAvatarImage.ts 详细注释

> 来源：`apps/web/src/composables/useAvatarImage.ts`
> 说明：本文件为 useAvatarImage composable 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 5-15 行）

```
/**
 * 将 avatar 字段（图片 URL/base64/`avatar://` 引用/文字）解析为可直接显示的图片 src
 *
 * - 直接图片（URL/base64）→ 原值
 * - 存储引用（avatar://xxx）→ 异步从 avatarStore 读 Blob → object URL
 * - 文字/空 → null（由 AvatarBadge 显示文字首字）
 *
 * object URL 生命周期管理：avatar 变化或 scope 销毁时 revoke，避免内存泄漏。
 *
 * 用法：`const src = useAvatarImage(() => persona.avatar)`，传给 AvatarBadge 的 src prop。
 */
```
