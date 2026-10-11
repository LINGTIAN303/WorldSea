use serde::{Deserialize, Serialize};

/// 自动链接配置，用于在创建实体时自动建立与目标实体的关系
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoLink {
  /// 目标实体类型名称
  pub target_type: String,
  /// 要创建的关系类型名称
  pub relation_type: String,
  /// 用于搜索目标实体的字段名
  pub search_field: Option<String>,
  /// 当目标实体不存在时是否自动创建
  pub create_if_missing: Option<bool>,
}

/// 字段模式定义，描述实体字段的类型、校验规则和展示方式
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldSchema {
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
  /// 枚举类型的可选值列表
  #[serde(default)]
  pub options: Option<Vec<String>>,
  /// 输入框的占位提示文本
  #[serde(default)]
  pub placeholder: Option<String>,
  /// 引用类型的目标实体类型名称
  #[serde(default)]
  pub ref_type: Option<String>,
  /// 引用字段对应的关系类型名称
  #[serde(default)]
  pub relation_type: Option<String>,
  /// 自动链接配置
  #[serde(default)]
  pub auto_link: Option<AutoLink>,
}

/// 实体类型模式定义，描述一种实体类型的元数据和字段结构
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityTypeSchema {
  /// 实体类型的唯一标识名称
  #[serde(rename = "type")]
  pub type_name: String,
  /// 实体类型的显示标签
  pub label: String,
  /// 实体类型的图标标识
  #[serde(default)]
  pub icon: Option<String>,
  /// 实体类型的内置字段列表
  pub fields: Vec<FieldSchema>,
  /// 用户自定义字段列表
  #[serde(default)]
  pub custom_fields: Option<Vec<FieldSchema>>,
  /// 注册该实体类型的插件 ID
  #[serde(default)]
  pub plugin_id: Option<String>,
}

/// 实体实例，表示世界中的一个具体实体对象
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entity {
  /// 实体的唯一标识符
  pub id: String,
  /// 实体所属的类型名称
  #[serde(rename = "type")]
  pub entity_type: String,
  /// 实体名称
  pub name: String,
  /// 实体描述
  #[serde(default)]
  pub description: String,
  /// 实体的动态属性，以 JSON 格式存储
  #[serde(default)]
  pub properties: serde_json::Value,
  /// 实体的标签列表
  #[serde(default)]
  pub tags: Vec<String>,
  /// 实体头像的 URL 或路径
  #[serde(default)]
  pub avatar: Option<String>,
  /// 实体创建时间
  #[serde(default)]
  pub created_at: String,
  /// 实体最后更新时间
  #[serde(default)]
  pub updated_at: String,
}
