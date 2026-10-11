use serde::{Deserialize, Serialize};

use super::entity::FieldSchema;

/// 关系类型模式定义，描述一种关系类型的元数据、方向性和约束
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationTypeSchema {
  /// 关系类型的唯一标识名称
  #[serde(rename = "type")]
  pub type_name: String,
  /// 关系类型的显示标签
  pub label: String,
  /// 允许作为关系源端的实体类型列表
  pub source_types: Vec<String>,
  /// 允许作为关系目标端的实体类型列表
  pub target_types: Vec<String>,
  /// 关系是否为有向关系
  pub directed: bool,
  /// 反向关系的类型名称
  #[serde(default)]
  pub inverse_type: Option<String>,
  /// 是否在创建关系时自动创建反向关系
  #[serde(default)]
  pub auto_create_inverse: Option<bool>,
  /// 关系类型的属性字段列表
  #[serde(default)]
  pub properties: Option<Vec<FieldSchema>>,
  /// 注册该关系类型的插件 ID
  #[serde(default)]
  pub plugin_id: Option<String>,
}

/// 关系实例，表示两个实体之间的具体关系
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Relation {
  /// 关系的唯一标识符
  pub id: String,
  /// 关系所属的类型名称
  #[serde(rename = "type")]
  pub relation_type: String,
  /// 关系源端实体的 ID
  pub source_id: String,
  /// 关系目标端实体的 ID
  pub target_id: String,
  /// 关系的显示标签
  #[serde(default)]
  pub label: Option<String>,
  /// 关系的动态属性，以 JSON 格式存储
  #[serde(default)]
  pub properties: serde_json::Value,
  /// 反向关系的配对 ID，用于关联双向关系
  #[serde(default)]
  pub pair_id: Option<String>,
  /// 关系创建时间
  #[serde(default)]
  pub created_at: String,
  /// 关系最后更新时间
  #[serde(default)]
  pub updated_at: String,
}
