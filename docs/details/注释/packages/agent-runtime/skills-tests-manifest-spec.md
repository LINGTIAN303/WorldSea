# manifest.spec.ts 详细注释文档（packages/agent-runtime/skills/__tests__）

> 来源：`packages/agent-runtime/src/skills/__tests__/manifest.spec.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-12 行）

```
manifest.ts 单元测试

验证 frontmatterToSkillMeta 的转换逻辑：
- emoji 图标清洗（项目规范：禁止 emoji 图标）
- category 规范化（无效值降级为 action）
- capabilities/schemaContext 传递
- 默认值兜底（id/name/promptFile/priority/version）

scanInstalledSkills 依赖 Tauri 运行时，由端到端测试覆盖；
此处聚焦纯函数 frontmatterToSkillMeta 的逻辑正确性。
```
