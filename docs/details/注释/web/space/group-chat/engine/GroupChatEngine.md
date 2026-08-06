# GroupChatEngine.ts 详细注释

> 来源：`apps/web/src/space/group-chat/engine/GroupChatEngine.ts`
> 说明：本文件为群聊引擎内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 199-208 行）

```
/**
 * 构建群聊 Agent 的独立系统提示词
 *
 * 分层注入：独立人格层 + 基础层（按 baseLayerMode 决定） + 技能/工具声明
 *
 * baseLayerMode:
 * - 'empty': 不注入基础层，不声明工具（纯聊天 NPC）
 * - 'shared': 注入标准共享基础层（buildSharedBaseLayer，含工具策略/输出规范/项目信息等），声明全部工具
 * - 'custom': 注入用户自定义基础层内容（member.customBaseLayer），按用户选择声明工具
 */
```

## 注释块 2（原文件第 248-258 行）

```
/**
 * 根据 Agent 的 baseLayerMode / toolSource / enabledSkills / enabledTools 解析工具集
 *
 * baseLayerMode 决策：
 * - 'empty': 纯聊天 NPC，不启用任何工具
 * - 'shared': 共享标准基础层 + 全部工具能力
 * - 'custom': 根据 toolSource 决定解析策略
 *   - toolSource='derived': 从 enabledSkills 派生工具
 *   - toolSource='manual': 使用 enabledTools 列表
 *   - 无 toolSource（旧数据）: 兼容旧逻辑
 */
```
