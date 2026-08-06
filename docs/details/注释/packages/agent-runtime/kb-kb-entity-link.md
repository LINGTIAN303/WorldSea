# kb-entity-link.ts 详细注释文档（packages/agent-runtime/kb）

> 来源：`packages/agent-runtime/src/kb/kb-entity-link.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-10 行）

```
实体-记忆图谱打通

将知识库条目与实体系统联动：
- 当记忆/知识涉及某个实体时，自动建立关联
- 查询实体时，联动检索相关知识
- 实体删除时，清理关联的知识索引

集成到 entity-crud 工具的 after-hook 中
```
