# useSidebarPhysics.ts 详细注释

> 来源：`apps/web/src/ui/layout/sidebar/useSidebarPhysics.ts`
> 说明：本文件为侧边栏轮播物理引擎 composable 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 28-42 行）

```
/**
 * 侧边栏轮播物理引擎 composable
 *
 * 职责:
 *  - 维护 pos / vel / springTarget 状态
 *  - 运行 RAF 物理循环(摩擦 + 弹簧吸附)
 *  - 提供接口:applyImpulse(滚轮) / springTo(点击跳转) / stop
 *
 * 不含:
 *  - DOM 事件处理(由 useSidebarInteraction 负责)
 *  - 视图切换副作用(通过 onSettle 回调通知上层)
 *  - DOM 样式更新(由 SidebarV2 的 syncDomStyles 负责)
 *
 * 这样分离后,物理逻辑可独立单元测试,无需模拟 DOM。
 */
```
