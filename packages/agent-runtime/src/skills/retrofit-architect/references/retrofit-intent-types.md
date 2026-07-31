# Retrofit 意图类型详细参数

## add_field
```json
{
  "entityType": "character",
  "field": {
    "key": "alignment",
    "label": "阵营",
    "type": "choice",
    "options": ["守序善良", "中立善良", "混乱善良", "守序中立", "绝对中立", "混乱中立", "守序邪恶", "中立邪恶", "混乱邪恶"]
  }
}
```

## remove_field
```json
{
  "entityType": "character",
  "fieldKey": "deprecated_field"
}
```

## modify_field
```json
{
  "entityType": "character",
  "fieldKey": "description",
  "changes": {
    "label": "角色描述",
    "type": "richtext"
  }
}
```

## add_entity_type
```json
{
  "typeKey": "deity",
  "label": "神祇",
  "icon": "⚡",
  "fields": [
    { "key": "domain", "label": "神域", "type": "text" },
    { "key": "power_level", "label": "力量等级", "type": "slider", "min": 1, "max": 10 },
    { "key": "worshipers", "label": "信徒数", "type": "number" }
  ]
}
```

## remove_entity_type
```json
{
  "typeKey": "deprecated_type",
  "migrateTo": "character"
}
```

## add_view / remove_view / modify_view
```json
{
  "viewKey": "faction_tree",
  "viewType": "tree",
  "config": { "groupBy": "faction", "sortBy": "rank" }
}
```

## change_theme
```json
{
  "theme": "dark-fantasy",
  "colors": {
    "primary": "#8b0000",
    "background": "#1a1a2e",
    "surface": "#16213e"
  }
}
```

## change_layout
```json
{
  "layout": "sidebar-detail",
  "config": { "sidebarWidth": 320, "detailPosition": "right" }
}
```
