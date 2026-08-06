# splash-canvas.ts 详细注释

> 来源：`apps/web/src/ui/boot/splash-canvas.ts`
> 说明：本文件为启动页 Canvas 动效引擎内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-10 行）

```
/**
 * splash-canvas.ts — WorldSmith 启动页 Canvas 动效引擎
 *
 * 双 Canvas 分层：
 *   - constellation 层：脉冲星座网络（固定动效，节点漂移 + 脉动 + 连线流光）
 *   - interaction 层：鼠标交互（光晕跟随 + 虚线引力线 + 涟漪扩散）
 *
 * 配色通过 getComputedStyle 读取项目 CSS 变量（跟随主题），fallback 到 Cyberpunk 默认值。
 * 设计稿来源：Ardot 设计文件 WorldSmith-Splash-Page (Cyberpunk UI 风格指南)
 */
```
