# entityStore — loadByType 增量语义（历史缺陷与裁定）

> 源文件：packages/entity-core/src/stores/entityStore.ts（loadByType）

## 历史缺陷（2026-09-18 修正）

此前实现是 `setAll(getEntitiesByType(type))` —— **整体替换** store 的 `entities`，于是「加载 character」会把其它所有类型（含大纲节点、章节…）**从内存里挤掉**，直到下一次 `loadAll()` 才恢复。表现为：Agent 在某芽里写一次 → 别的芽实体集体消失。这是框架级陷阱，曾影响 4 条工作线（workflow 5 处 / outline 1 处 / characters 2 处 / drawing 1 处）。

## 为什么改成增量而不是「删掉本 API」

调用方（如 `CharacterList`）是**刻意的按类型轻量加载**（它同时只 `loadAll()` 关系、不 loadAll 实体），所以「按类型加载」本身是有效意图；有问题的只是「顺带清掉别的类型」这个副作用。故保留 API 名与调用点不变，只修副作用。

## 语义

该类型以 storage 为准**整体替换**（磁盘上已删除的会从内存移除），其它类型**原样保留**。幂等、可重复调用。
