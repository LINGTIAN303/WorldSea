# idleRaf.ts 详细注释

> 来源：`packages/perf-kit/src/render/idleRaf.ts`
> 说明：本文件为 idleRaf 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-16 行）

````
/**
 * 空闲 RAF 管理器（idleRaf）。有交互时运行动画循环，空闲超时后自动暂停，
 * 避免后台任务持续占用 CPU。
 *
 * 解决 PERF-22：长任务/动画无空闲暂停机制，常驻占用 CPU。
 *
 * 用法：
 *   const raf = createIdleRaf({ idleTimeout: 3000 })
 *   raf.start((dt) => { dt 为距上次 tick 的毫秒数 })
 *
 *   // 用户交互时调用，重置空闲计时（若已暂停则自动恢复）
 *   window.addEventListener('pointermove', () => raf.notifyActive())
 *
 *   // 组件卸载时调用
 *   onBeforeUnmount(() => raf.stop())
 */
````
