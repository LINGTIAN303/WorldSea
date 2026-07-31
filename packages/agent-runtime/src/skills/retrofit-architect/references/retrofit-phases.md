# Retrofit 阶段说明

## 会话生命周期

```
begin_session → submit_intent → confirm_and_stage → apply_next → verify_and_accept → end_session
                                     ↑                  ↓              ↓
                                     └── rollback_last ←┘              │
                                                                        │
                              abort ──────────────────────────────────→┘
```

## 各阶段说明

### begin_session
- 开启改造会话，获取 session_id
- 此后所有操作都需携带 session_id

### submit_intent
- 提交改造意图，描述要做什么
- 系统会分析意图的可行性和影响范围
- 返回预览信息（将影响的实体数、字段数等）

### confirm_and_stage
- 确认意图，将变更暂存
- 暂存的变更尚未应用到实际数据
- 可以多次 submit + confirm 暂存多个变更

### apply_next
- 应用下一个暂存的变更
- 每次只应用一个变更，便于逐步验证

### verify_and_accept
- 验证已应用的变更
- 如果验证通过，变更被接受
- 如果验证失败，可以使用 request_repair 或 rollback_last

### rollback_last
- 回滚上一个已应用的变更
- 只能回滚尚未 accept 的变更

### abort
- 紧急中止整个会话
- 所有未接受的变更将被丢弃
- 已接受的变更不受影响

### end_session
- 正常结束会话
- 释放会话资源

## 冲突处理

使用 `retrofit_detect_conflicts` 检测会话期间的外部变更冲突。

冲突类型：
- `data_modified`: 数据在改造期间被外部修改
- `schema_changed`: Schema 在改造期间被外部修改
- `concurrent_session`: 存在并行的改造会话

冲突解决策略：
1. `redirect`: 重定向到新数据
2. `request_repair`: 请求修复冲突
3. `abort`: 中止会话
