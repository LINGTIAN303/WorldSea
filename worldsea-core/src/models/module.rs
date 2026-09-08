use serde::{Deserialize, Serialize};

/// 模块字段定义，描述模块中实体或关系类型的字段结构
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleField {
  /// 字段唯一标识键
  pub key: String,
  /// 字段的显示标签
  pub label: String,
  /// 字段的数据类型
  #[serde(rename = "type")]
  pub field_type: String,
  /// 该字段是否为必填
  #[serde(default)]
  pub required: Option<bool>,
  /// 字段的默认值
  #[serde(default)]
  pub default_value: Option<serde_json::Value>,
  /// 输入框的占位提示文本
  #[serde(default)]
  pub placeholder: Option<String>,
  /// 字段的帮助说明文本
  #[serde(default)]
  pub help_text: Option<String>,
  /// 枚举类型的可选值列表
  #[serde(default)]
  pub options: Option<Vec<String>>,
  /// 数值字段的最小值
  #[serde(default)]
  pub min: Option<f64>,
  /// 数值字段的最大值
  #[serde(default)]
  pub max: Option<f64>,
  /// 数值字段的步进值
  #[serde(default)]
  pub step: Option<f64>,
  /// 字段值的正则校验表达式
  #[serde(default)]
  pub regex: Option<String>,
  /// 是否在列表视图中显示该字段
  #[serde(default)]
  pub show_in_list: Option<bool>,
  /// 引用类型的目标实体类型名称
  #[serde(default)]
  pub ref_type: Option<String>,
}

/// 模块实体类型定义，描述模块中一种实体类型的结构
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleEntityType {
  /// 实体类型名称
  pub name: String,
  /// 实体类型的显示标签
  pub label: String,
  /// 实体类型的图标标识
  pub icon: String,
  /// 实体类型的主题色
  pub color: String,
  /// 实体类型的字段列表
  pub fields: Vec<ModuleField>,
}

/// 模块关系类型定义，描述模块中一种关系类型的结构
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleRelationType {
  /// 关系类型名称
  pub name: String,
  /// 关系类型的显示标签
  pub label: String,
  /// 允许作为关系源端的实体类型列表
  pub source_types: Vec<String>,
  /// 允许作为关系目标端的实体类型列表
  pub target_types: Vec<String>,
  /// 关系是否为有向关系
  pub directed: bool,
  /// 关系类型的属性字段列表
  pub properties: Vec<ModuleField>,
  /// 关系类型的图标标识
  #[serde(default)]
  pub icon: Option<String>,
}

/// 模块视图配置，定义模块中一种视图的展示方式
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleViewConfig {
  /// 视图的唯一标识
  pub id: String,
  /// 视图的显示标签
  pub label: String,
  /// 视图的图标标识
  pub icon: String,
  /// 视图的类型
  #[serde(rename = "type")]
  pub view_type: String,
  /// 视图关联的实体类型名称
  pub entity_type: String,
  /// 视图中显示的字段键名列表
  pub show_fields: Vec<String>,
  /// 排序依据的字段键名
  #[serde(default)]
  pub sort_by: Option<String>,
  /// 排序方向
  #[serde(default)]
  pub sort_order: Option<String>,
  /// 视图的筛选条件列表
  #[serde(default)]
  pub filters: Option<Vec<ModuleFilter>>,
  /// 视图类型的额外配置选项
  #[serde(default)]
  pub view_options: Option<serde_json::Value>,
}

/// 模块筛选条件，定义视图中的单条筛选规则
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleFilter {
  /// 筛选目标字段键名
  pub field: String,
  /// 筛选操作符
  pub operator: String,
  /// 筛选值
  pub value: String,
}

/// 模块依赖声明，描述当前模块对其他模块的依赖关系
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleDependency {
  /// 依赖的目标模块 ID
  pub module_id: String,
  /// 依赖所需的实体或关系类型列表
  #[serde(default)]
  pub required_types: Vec<String>,
}

/// 自定义模块，包含完整的模块定义，可被安装和复用
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomModule {
  /// 模块的唯一标识符
  pub id: String,
  /// 模块名称
  pub name: String,
  /// 模块图标标识
  pub icon: String,
  /// 模块描述
  pub description: String,
  /// 模块定义的实体类型列表
  pub entity_types: Vec<ModuleEntityType>,
  /// 模块定义的关系类型列表
  pub relation_types: Vec<ModuleRelationType>,
  /// 模块定义的视图配置列表
  pub views: Vec<ModuleViewConfig>,
  /// 模块的依赖列表
  #[serde(default)]
  pub dependencies: Option<Vec<ModuleDependency>>,
  /// 模块创建时间
  #[serde(default)]
  pub created_at: String,
  /// 模块最后更新时间
  #[serde(default)]
  pub updated_at: String,
}
