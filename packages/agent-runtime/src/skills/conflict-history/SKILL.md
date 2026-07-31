---
name: conflict-history
description: >
  冲突与战争史编撰。当用户需要创建战争、战役、冲突事件或分析军事历史时激活。
  支持冲突类型：全面战争/局部冲突/内战/起义/侵略/防御战/冷冲突/贸易战/其他。
  规模层级：全球/区域/国家/地方/小规模。可构建子战役层级。对应 conflict 插件。
  关键词：冲突、战争、战役、内战、起义、侵略、指挥官、伤亡、和约、军事。
capabilities:
  internal:
    - entity.list
    - entity.get
    - entity.create
    - entity.update
    - relation.create
    - relation.list
    - content_search
    - consistency_check
    - ui.output.entity-card
    - ui.output.table
  plugin:
    conflict:
      - conflict_list
      - conflict_create
      - conflict_update
      - conflict_get_participants
schema-context:
  entity-types:
    - conflict
  field-policy: prefer-defined
---

# 冲突编年技能

## 目标

编撰逻辑严谨、因果清晰的冲突与战争史，确保每场冲突都有完整的起因-过程-结果链条、合理的参战方配置和对世界观的长期影响评估。

## 触发条件

- 用户要求创建战争、战役、冲突事件
- 用户要求分析冲突的参战方、因果链或历史影响
- 用户要求构建大战役的子战役层级
- 用户提到"冲突""战争""战役""内战""起义""侵略""指挥官""伤亡"等词

## 实体模型

**conflict** 核心属性：

| 属性 | 说明 | 必填 |
|------|------|------|
| name | 冲突名称 | ✅ |
| conflictType | 类型（全面战争/局部冲突/内战/起义/侵略/防御战/冷冲突/贸易战/其他） | ✅ |
| scale | 规模（全球/区域/国家/地方/小规模） | ✅ |
| startDate | 开始时间 | 推荐 |
| endDate | 结束时间 | 推荐 |
| cause | 起因（政治/经济/宗教/领土/种族/意识形态） | 推荐 |
| result | 结果（胜负/和谈/僵持/未决） | 推荐 |
| casualties | 伤亡规模 | 可选 |
| treaty | 和约/协议 | 可选 |

## 关联关系

| 关系类型 | 目标类型 | 说明 |
|---------|---------|------|
| `participant_force` | organization | 参战势力 |
| `participant_commander` | character | 指挥官 |
| `battlefield` | region | 战场 |
| `related_event` | event | 关联事件（导火索/转折点/结局事件） |
| `legendary_item` | item | 传奇兵器/圣物 |
| `sub_conflict` | conflict | 子战役（从父冲突指向子冲突） |

## 核心方法论

1. **起因-过程-结果闭环**：每场冲突必须有清晰的因果链——起因推动过程，过程决定结果，结果影响后续
2. **多视角叙事**：参战各方都有自己的立场和动机，避免单一视角的"正义叙事"
3. **规模一致性**：伤亡数字、战场范围、参战势力数量应与规模等级匹配
4. **层级分解**：大规模冲突（全球/区域级）应拆分为子战役，各有独立目标和结果

## 标准工作流程

### 场景一：创建新冲突

1. 使用 `conflict_list` 查看已有冲突，检查时间线和势力格局
2. 确定冲突类型、规模和时代背景
3. 使用 `conflict_create` 创建条目，填充起因和结果
4. 使用 `relation_create` 关联参战势力（participant_force）、指挥官（participant_commander）、战场（battlefield）
5. 关联导火索事件（related_event）和签订和约（treaty）
6. 使用 `consistency_check` 验证时间线与已有事件不矛盾

### 场景二：构建子战役层级

1. 使用 `conflict_get_participants` 获取父冲突的完整信息
2. 按时间线或地理线拆分为子战役
3. 使用 `conflict_create` 创建每个子战役
4. 使用 `relation_create` 建立 `sub_conflict` 关系
5. 确保子战役的时间范围在父冲突范围内

### 场景三：冲突影响分析

1. 使用 `conflict_list` 获取相关冲突群
2. 分析每场冲突的长期影响：
   - 领土变更 → 更新 region 的控制关系
   - 势力兴衰 → 更新 organization 的状态
   - 人口变迁 → 更新角色的存亡状态
   - 技术/文化扩散 → 关联新的 culture/language
3. 推演冲突如何催生后续事件（和平协议 → 新矛盾 → 下一次冲突）

## 质量审核清单

- [ ] 每场冲突有清晰的起因-过程-结果链
- [ ] 参战双方至少各有一个势力和一个指挥官
- [ ] 大规模冲突已拆分为子战役
- [ ] 伤亡和和约的数量级与规模匹配
- [ ] 冲突时间与时间线事件不矛盾
- [ ] 结果字段有具体描述（非简单"胜利"）
- [ ] 参战势力的动机有逻辑依据

## Gotchas

- `conflict_create` 优先于 `entity_create(type=conflict)`——前者自动填充 conflict 插件专用字段
- `conflict_get_participants` 返回所有关联实体（势力/指挥官/战场/事件/兵器），适合做全局概览
- `sub_conflict` 关系方向：从父冲突指向子战役
- 伤亡数字应与世界观的人口规模一致——小世界不应出现百万级伤亡
- 检查冲突时间范围：startDate 必须早于 endDate，子战役时间必须在父冲突范围内
- 贸易战/冷冲突等非常规冲突，参战方关系可能不是简单的敌对

## 输出格式

```
## 冲突档案：[名称]

### 基本信息
| 属性 | 值 |
|------|-----|
| 类型 | [conflictType] |
| 规模 | [scale] |
| 时间 | [startDate] - [endDate] |
| 结果 | [result] |

### 起因
[cause 详细描述]

### 参战方
| 阵营 | 势力 | 指挥官 | 战场 |
|------|------|--------|------|
| [方] | [organization] | [character] | [region] |

### 过程概述
[关键转折点和战役阶段]

### 结果与影响
- **直接结果**: [result]
- **伤亡**: [casualties]
- **和约**: [treaty]
- **长期影响**: [影响分析]

### 子战役
- [子战役1]: [简述]
- [子战役2]: [简述]
```

## 工具优先级

1. `conflict_list` / `conflict_get_participants` → 查询（优先使用插件工具）
2. `conflict_create` / `conflict_update` → 创建/更新
3. `relation_create` → 建立参战方/战场/事件关联
4. `consistency_check` → 时间线一致性验证
5. `content_search` → 搜索关联设定
