# motion-override.ts 详细注释文档（theme-kit）

> 来源：`packages/theme-kit/src/motion-override.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-10 行）

# @worldsea/theme-kit - Motion Override Engine

动画风格覆盖逻辑：

- 覆盖缓动函数（`--ease-*`）
- 覆盖时长（`--duration-*`）
- 覆盖 motion-scale
- 注入自定义关键帧
- 设置交互模式 `data-interaction-mode`

---

## 模块职责一句话

Motion Override Engine：按主题覆盖 CSS 动画变量（缓动/时长/motion-scale）并注入自定义关键帧与交互模式标识。
