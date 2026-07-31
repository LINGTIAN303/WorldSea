---
name: building-geography
description: >
  建筑与地理场所设计。当用户需要创建建筑、设计内部布局、构建通道连接时激活。
  支持 16 种建筑类型（宫殿/城堡/民居/商铺/神殿/军事要塞/学院/监狱/图书馆/工坊/酒馆/桥梁/港口/灯塔/墓地/其他）。
  10 种建筑风格（古典/哥特/巴洛克/现代/奇幻/东方/古典复兴/乡村/地下/混合）。
  可关联地域、组织、拥有者、常驻者、存放道具、事件发生地。对应 buildings 插件。
  关键词：建筑、场所、城堡、宫殿、神殿、要塞、学院、布局、通道、地理、空间。
capabilities:
  internal:
    - entity.list
    - entity.get
    - entity.create
    - entity.update
    - entity.delete
    - relation.create
    - relation.list
    - content_search
    - algo.shortest-path
    - ui.output.entity-card
  plugin:
    buildings:
      - building_list
      - building_create
      - building_update
      - building_get_layout
schema-context:
  entity-types:
    - building
  field-policy: prefer-defined
---

# 建筑地理设计技能

## 目标

设计有空间深度和叙事价值的建筑与场所，构建建筑间的包含关系和通道连接，使每个建筑都成为世界观中可感知、可探索的地点。

## 触发条件

- 用户要求创建建筑、设计场所
- 用户要求设计建筑的内部布局或通道连接
- 用户要求查找建筑间的路径或分析空间关系
- 用户提到"建筑""场所""城堡""宫殿""布局""通道""地理""空间"等词

## 实体模型

**building** 核心属性：

| 属性 | 说明 | 必填 |
|------|------|------|
| name | 建筑名称 | ✅ |
| buildingType | 类型（宫殿/城堡/神殿/军事要塞/学院/图书馆等 16 种） | ✅ |
| floors | 层数 | 推荐 |
| area | 面积 | 可选 |
| style | 建筑风格（古典/哥特/巴洛克/现代/奇幻/东方等 10 种） | 推荐 |
| era | 建造年代 | 推荐 |
| builder | 建造者 | 可选 |
| status | 现状（使用中/废弃/废墟/在建/被占领） | 推荐 |
| materials | 主要建材 | 可选 |
| significance | 历史/文化意义 | 推荐 |

## 关联关系

| 关系类型 | 目标类型 | 说明 | 附加信息 |
|---------|---------|------|----------|
| `located_in` | region | 位于某地域 | 含地址描述 |
| `belongs_to` | organization | 归属于组织 | 含归属说明 |
| `owned_by` | character | 拥有者 | 含起始时间 |
| `resident` | character | 常驻者 | 含居住原因 |
| `contains` | building | 包含子建筑 | 空间包含关系 |
| `connected_to` | building | 通道连接 | 含通道类型（门/走廊/地道/桥/传送门/密道） |
| `stored_at` | item | 存放道具 | 含存放位置描述 |
| `event_location` | event | 事件发生地 | 含事件描述 |

## 核心方法论

1. **空间叙事**：每个建筑空间都讲述故事——大厅展示权力，密室隐藏阴谋，废墟暗示过去
2. **功能分区**：建筑内部按功能分区（居住/防御/仪式/储藏/工作），分区反映使用者的需求
3. **通道逻辑**：通道连接必须符合物理逻辑——密道有入口和出口，传送门有能量来源
4. **风格统一**：建筑风格应与所在地域的文化特征、时代背景和建造者身份匹配

## 标准工作流程

### 场景一：创建新建筑

1. 使用 `building_list` 查看已有建筑，了解区域建筑分布
2. 确定建筑类型、风格、规模和年代
3. 使用 `building_create` 创建条目
4. 使用 `relation_create` 建立 `located_in`（关联地域）和 `belongs_to`（关联组织）
5. 关联拥有者和常驻者

### 场景二：设计内部布局

1. 使用 `building_get_layout` 获取建筑的现有布局
2. 按功能划分内部区域（使用 `contains` 关系创建子建筑/房间）
3. 使用 `connected_to` 建立通道连接，标注通道类型
4. 使用 `stored_at` 关联存放的重要道具
5. 使用 MermaidRender 可视化布局图

### 场景三：路径与连通性分析

1. 使用 `algo_run(action='shortest_path')` 查找两个建筑之间的最短路径
2. 分析建筑群的连通性：是否存在孤岛建筑？
3. 识别关键节点（被多个通道连接的核心建筑）
4. 推演战术意义（城堡的防线、密道的战略价值）

## 质量审核清单

- [ ] 每个建筑至少关联一个地域（located_in）
- [ ] 建筑风格与所在地域的文化/时代匹配
- [ ] 内部布局有功能分区，非空洞空间
- [ ] 通道连接符合物理逻辑（密道有合理入口）
- [ ] status 字段反映建筑当前状态
- [ ] 建筑名称风格与世界观一致
- [ ] 大型建筑群有 contains 层级结构

## Gotchas

- `building_create` 优先于 `entity_create(type=building)`——前者自动填充 buildings 插件专用字段
- `building_get_layout` 返回建筑的 contains 和 connected_to 关系，适合做布局概览
- `contains` 关系方向：从父建筑指向子建筑/房间
- `connected_to` 是双向关系——如果 A 连接到 B，B 也连接到 A（除非是单向密道）
- 通道类型要在关系属性中标注，不要只建关系不标类型
- `algo_run(action='shortest_path')` 基于 connected_to 关系计算路径，无通道连接的建筑不可达

## 输出格式

```
## 建筑档案：[名称]

### 基本信息
| 属性 | 值 |
|------|-----|
| 类型 | [buildingType] |
| 风格 | [style] |
| 层数 | [floors] |
| 年代 | [era] |
| 现状 | [status] |

### 空间布局
[包含关系描述]

### 通道连接
| 连接目标 | 通道类型 | 说明 |
|---------|---------|------|
| [建筑名] | [门/走廊/密道/...] | [描述] |

### 关联实体
| 关系 | 目标 | 说明 |
|------|------|------|
| 位于 | [region] | [地址] |
| 归属 | [organization] | [说明] |
| 拥有者 | [character] | [起始时间] |
| 常驻者 | [character] | [原因] |
```

## 工具优先级

1. `building_list` / `building_get_layout` → 查询（优先使用插件工具）
2. `building_create` / `building_update` → 创建/更新
3. `relation_create` → 建立空间/通道/归属关系
4. `algo_run(action='shortest_path')` → 路径分析
5. `content_search` → 搜索关联设定
