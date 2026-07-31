# worldsmith-server (DEPRECATED)

> ⚠️ **此包已废弃** — Phase 4 端分离

此服务的能力已迁移到 `@worldsmith/cli` 的 `serve` 命令。

## 迁移方式

```bash
# 旧方式（已废弃）
cd worldsmith-server && npm run dev

# 新方式
cd apps/cli && npm run start -- serve --port 3100
```

## 迁移说明

详见 [docs/端分离/11-backend-consolidation.md](../docs/端分离/11-backend-consolidation.md)

## 删除计划

此目录计划在 Phase 6（端到端验收）后完全删除。
