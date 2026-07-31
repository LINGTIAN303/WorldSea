---
name: combat-system
description: >
  战力体系设计与数值平衡。当用户需要设计境界体系、等级系统、数值对比或关联角色战力时激活。
  支持三种体系：境界制（修仙/武道层级）、等级制（西方奇幻数字等级）、数值制（HP/MP/ATK/DEF/SPD属性化）。
  文化圈：中式/西式/混合。可关联角色境界、所需技能、修炼圣地、突破道具。对应 combat_stats 插件。
  关键词：战力、境界、等级、数值、晋升、突破、修炼、修仙、武道。
capabilities:
  internal:
    - entity.list
    - entity.get
    - entity.create
    - entity.update
    - relation.create
    - relation.list
    - content_search
    - algo.graph.analyze
    - consistency_check
    - ui.output.table
  plugin:
    combat_stats:
      - combat_stat_list
      - combat_stat_create
      - combat_stat_update
      - combat_stat_compare
schema-context:
  entity-types:
    - combat_stat
  field-policy: prefer-defined
---

# 战力体系设计技能

## 目标

设计逻辑自洽、数值平衡的战力体系，确保每个层级有清晰的晋升条件、瓶颈和战力表现，并与角色、技能、道具有机关联。

## 触发条件

- 用户要求设计境界体系、等级系统或数值属性
- 用户要求比较多个战力的数值或分析平衡性
- 用户要求关联角色到对应的境界/等级
- 用户提到"战力""境界""等级""数值""晋升""突破""修炼""修仙""武道"等词

## 实体模型

**combat_stat** 核心属性：

| 属性 | 说明 | 必填 |
|------|------|------|
| name | 战力条目名称 | ✅ |
| system | 体系类型（境界制/等级制/数值制） | ✅ |
| tier | 层级排序（数字） | ✅ |
| realm | 境界名称（境界制专用） | 境界制必填 |
| promotion | 晋升条件 | 推荐 |
| bottleneck | 瓶颈描述 | 推荐 |
| power | 战力表现（可量化的能力描述） | 推荐 |
| culture | 文化圈（中式/西式/混合） | 推荐 |

## 体系类型详解

### 境界制
修仙/武道类，层级为具名境界：
```
炼气 → 筑基 → 金丹 → 元婴 → 化神 → 渡劫 → 大乘 → ...
```
每个境界有：进入条件、修炼方式、突破瓶颈、寿元增长

### 等级制
西方奇幻类，数字等级（1-100级或自定义范围）：
```
1-10: 新手 → 11-30: 冒险者 → 31-60: 精英 → 61-90: 英雄 → 91-100: 传说
```
每个区间有：能力解锁点、属性增长率、技能获取条件

### 数值制
属性数值化，多维度对比：
```
HP / MP / ATK / DEF / SPD / INT / DEX / LUK
```
每个属性有：成长曲线、上限设定、互相克制关系

## 关联关系

| 关系类型 | 目标类型 | 说明 |
|---------|---------|------|
| `current_realm` | character | 角色当前境界 |
| `required_skill` | magic | 该层级所需技能 |
| `training_ground` | region | 修炼圣地 |
| `breakthrough_item` | item | 突破所需丹药/法器 |
| `racial_cap` | species | 种族战力上限 |

## 核心方法论

1. **数值递增有规律**：战力增长应遵循可预测的曲线（线性/指数/S曲线），避免突然跳变
2. **瓶颈有意义**：每个层级的突破瓶颈应有叙事价值——不只是"修炼够了就突破"
3. **天花板设计**：体系顶端应有明确的天花板和突破代价，避免无限膨胀
4. **种族差异**：不同种族可能有不同的战力上限（racial_cap），但每个种族内部应保持平衡

## 标准工作流程

### 场景一：设计新战力体系

1. 使用 `combat_stat_list` 查看已有战力条目
2. 确定体系类型（境界制/等级制/数值制）和文化圈
3. 设计完整层级规划（总层数、每层名称和定位）
4. 使用 `combat_stat_create` 逐级创建，填充晋升条件和瓶颈
5. 使用 `combat_stat_compare` 对比多层级数值，验证递增曲线合理

### 场景二：关联角色与战力

1. 使用 `entity_get` 获取角色信息，确定适合的层级
2. 使用 `relation_create` 建立 `current_realm` 关系
3. 如有突破需求，建立 `breakthrough_item`（关联道具）和 `training_ground`（关联修炼地）
4. 检查角色属性与层级的一致性

### 场景三：平衡性分析

1. 使用 `combat_stat_list` 获取全部层级数据
2. 使用 `combat_stat_compare` 对比关键层级的数值差距
3. 分析以下平衡维度：
   - 相邻层级战力差距是否合理（不应出现越级秒杀）
   - 种族上限差异是否有叙事补偿
   - 顶层战力是否过于碾压底层
4. 使用 `consistency_check` 验证体系一致性

## 质量审核清单

- [ ] 每个层级有清晰的晋升条件和瓶颈描述
- [ ] 数值递增遵循可预测的曲线
- [ ] 顶层有明确的天花板设计
- [ ] 种族战力上限（racial_cap）有叙事解释
- [ ] 关联角色的 current_realm 与其属性匹配
- [ ] 突破道具（breakthrough_item）确实存在于 items 中
- [ ] 修炼圣地（training_ground）确实存在于 regions 中

## Gotchas

- `combat_stat_create` 优先于 `entity_create(type=combat_stat)`——前者自动填充 combat_stats 插件专用字段
- `combat_stat_compare` 支持传入多个 statIds 进行并行对比，适合做平衡性分析
- `current_realm` 关系方向：从角色指向战力条目
- 境界名称应与世界观的文化氛围一致（中式世界用"金丹/元婴"，西式世界用"青铜/白银"）
- 数值制体系注意属性之间的克制关系——不要出现某个属性完全无用
- 设计新体系前先用 `content_search` 搜索已有的魔法/种族/势力设定，确保匹配

## 输出格式

```
## 战力体系：[体系名]

### 体系概览
| 属性 | 值 |
|------|-----|
| 类型 | [system] |
| 文化圈 | [culture] |
| 总层数 | [N] |

### 层级一览
| 层级 | 境界/等级 | 晋升条件 | 瓶颈 | 战力表现 |
|------|----------|---------|------|---------|
| 1 | [realm] | [promotion] | [bottleneck] | [power] |

### 数值曲线
[combat_stat_compare 结果描述]

### 关联实体
| 角色 | 当前境界 | 突破需求 |
|------|---------|---------|
| [character] | [realm] | [item/条件] |
```

## 工具优先级

1. `combat_stat_list` / `combat_stat_compare` → 查询（优先使用插件工具）
2. `combat_stat_create` / `combat_stat_update` → 创建/更新
3. `relation_create` → 建立角色/技能/道具/地域关联
4. `consistency_check` → 体系一致性验证
5. `algo_run(action='graph_analysis')` → 战力网络分析
