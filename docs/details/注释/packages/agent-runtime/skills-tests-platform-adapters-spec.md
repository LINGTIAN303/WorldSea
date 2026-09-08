# platform-adapters.spec.ts 详细注释文档（packages/agent-runtime/skills/__tests__）

> 来源：`packages/agent-runtime/src/skills/__tests__/platform-adapters.spec.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-10 行）

```
platform-adapters.ts 单元测试

验证多平台技能格式互通：
- 格式检测（detectPlatform）
- Claude Code SKILL.md 导入/导出
- Cursor .mdc 导入/导出（globs → tags 映射）
- WorldSea skill.yaml 导入/导出
- 往返转换一致性（导出后再导入，核心字段保持一致）
```
