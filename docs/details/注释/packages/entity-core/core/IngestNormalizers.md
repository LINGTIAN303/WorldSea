# IngestNormalizers — 实体装载边界归一器

> 源文件：packages/entity-core/src/core/IngestNormalizers.ts

## 模块背景（2026-10-11）

创作数据文件是多写入方汇合点（Agent 经 dsh 插件直写 JSON / 项目导入 / 手工放置），写入侧格式不受控（如笔记本正文以 markdown 纯文本落盘）。若各消费方（编辑器/预览/导出）各自兜底解析，格式兼容逻辑会重复且易漂移。本模块在**装载边界**（entityStore 的 loadAll/loadByType/loadByPage/getById）提供 per-type 归一钩子：实体进内存 store 前按类型变换一次，此后所有消费方只见归一后的形态。

## 设计约束

- entity-core 是通用层，不认识任何具体类型语义 —— 归一器由各芽插件在 apply 时注册（如 notebook 注册 content 的 md→HTML 归一），本模块只持引用。
- 归一必须**幂等**（已归一内容再过一遍原样返回）：装载路径会被 watcher 回流反复触发，非幂等会越装载越乱。
- 归一器「无变化返回原引用」：调用方（useShallowArray）按引用替换驱动响应式，无谓的新对象会造成多余更新。
