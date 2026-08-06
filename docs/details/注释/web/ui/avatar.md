# avatar.ts 详细注释

> 来源：`apps/web/src/ui/avatar.ts`
> 说明：本文件为统一头像工具函数内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-12 行）

```
/**
 * 统一头像工具函数
 *
 * 统一多处分散的头像生成规则（SpaceNavbar / 单聊消息气泡 / UserProfilePopover /
 * CreateAgentDialog / 群聊消息），支持：
 * - 图片头像（URL / base64 data URI / blob / 存储引用 avatar://）
 * - 文字首字头像
 * - 统一背景色规则
 *
 * 存储引用（avatar://xxx）需配合 useAvatarImage composable 异步解析为可显示 URL
 * （Phase 4 图片头像入口实现）。
 */
```
