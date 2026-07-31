# A2UI 组件选择目录

## 数据展示类

### EditableTable（可编辑表格）
- 数据结构：`{ columns: [{key, label, editable}], rows: [{...}] }`
- 适用：实体对比、属性列表、批量数据
- 交互：内联编辑、行增删、排序

### EntityCard（实体卡片）
- 数据结构：绑定到 dataModel 的实体数据
- 适用：单个实体详情展示
- 交互：查看、编辑、删除按钮

### StatBar（统计条）
- 数据结构：`{ label, value, min, max }`
- 适用：数值属性展示（力量/智力等）

### TagGroup（标签组）
- 数据结构：`{ tags: string[] }`
- 适用：标签列表展示

## 可视化类

### ChartView（数据图表）
- 数据结构：`{ chartType, option }` (ECharts 配置)
- chartType: bar / pie / line / radar / scatter
- 适用：数值分析、排名对比、趋势展示

### MermaidRender（流程图渲染）
- 数据结构：`{ code: string }` (Mermaid 语法)
- 适用：关系图、流程图、时序图、甘特图

### SvgCanvas（SVG 画布）
- 数据结构：`{ svg: string }` (SVG 代码)
- 适用：地图、建筑平面图、武器图解

## 交互类

### SuggestionPicker（建议选择器）
- 数据结构：`{ title, options: [{id, label, description}] }`
- 适用：方案选择、生成选项、A/B/C 选项

### ConfirmBar（确认栏）
- 数据结构：`{ message, confirmText, cancelText }`
- 适用：危险操作确认、写入前确认

### ChoicePicker（选择器）
- 数据结构：`{ label, options: [{value, label}] }`
- 适用：单选/多选

## 代码类

### CodeBlock（代码块）
- 数据结构：`{ language, code, runnable }`
- 适用：代码展示、代码笔记
- 交互：语法高亮、运行按钮（runnable=true 时）

## 文件类

### FilePreview（文件预览）
- 数据结构：`{ fileName, fileType, summary, suggestions: [{target, reason}] }`
- 适用：上传文件的分析结果展示

## 链接类

### EntityLink（实体链接）
- 数据结构：`{ entityId, entityType, name }`
- 适用：在输出中引用实体，点击跳转
