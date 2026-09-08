use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use super::animation::{ViewAnimationConfig, FieldAnimationConfig};
use super::validation::ValidationRule;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityTypeSchema {
    pub type_key: String,
    pub label: String,
    pub icon: String,
    #[serde(default)]
    pub fields: Vec<FieldSchema>,
    #[serde(default)]
    pub relations: Vec<RelationTypeSchema>,
    #[serde(default)]
    pub validations: Vec<ValidationRule>,
    #[serde(default)]
    pub views: Vec<ViewDeclaration>,
    #[serde(default)]
    pub icon_map: HashMap<String, String>,
    #[serde(default)]
    pub id_prefix: String,
    pub plugin_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldSchema {
    pub key: String,
    pub label: String,
    pub field_type: FieldType,
    #[serde(default)]
    pub required: bool,
    pub default_value: Option<serde_json::Value>,
    #[serde(default)]
    pub options: Vec<SelectOption>,
    pub placeholder: Option<String>,
    pub ref_type: Option<String>,
    pub auto_link: Option<AutoLinkConfig>,
    pub animation: Option<FieldAnimationConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FieldType {
    Text,
    Textarea,
    Number,
    Boolean,
    Date,
    Image,
    Select,
    MultiSelect,
    Formula,
    Color,
    EntityRef,
    Tags,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectOption {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationTypeSchema {
    pub type_key: String,
    pub label: String,
    #[serde(default)]
    pub source_types: Vec<String>,
    #[serde(default)]
    pub target_types: Vec<String>,
    #[serde(default)]
    pub directed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewDeclaration {
    pub view_type: ViewType,
    #[serde(default)]
    pub config: serde_json::Value,
    pub animation: Option<ViewAnimationConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ViewType {
    List,
    Tree,
    Graph,
    Timeline,
    Grid,
}

impl Default for ViewType {
    fn default() -> Self { ViewType::List }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoLinkConfig {
    pub target_type: String,
    pub relation_type: String,
    pub search_field: Option<String>,
    pub create_if_missing: Option<bool>,
}
