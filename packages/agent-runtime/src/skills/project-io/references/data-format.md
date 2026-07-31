# 项目数据格式规范

## 导出格式

```json
{
  "version": "1.0",
  "exportedAt": "2026-01-01T00:00:00Z",
  "entities": [...],
  "relations": [...],
  "schema": {...}
}
```

## 导入验证清单

- [ ] version 字段存在且兼容
- [ ] entities 数组非空
- [ ] 每个 entity 有 id/name/type
- [ ] relations 中的 source/target 引用有效
- [ ] schema 定义完整

## 常见导入错误

| 错误 | 原因 | 修复 |
|------|------|------|
| 缺少 version | 旧格式导出 | 添加 version 字段 |
| 无效 entity ID | ID 格式不正确 | 使用 UUID 格式 |
| 断裂关系 | source/target 不存在 | 移除或修复引用 |
| schema 不匹配 | 字段类型变更 | 更新 schema 定义 |
