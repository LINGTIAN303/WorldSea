use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldDef {
  pub name: String,
  pub field_type: FieldType,
  pub label: String,
  pub required: bool,
  pub default_value: Option<serde_json::Value>,
  pub options: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FieldType {
  Text,
  Number,
  Boolean,
  Select,
  MultiSelect,
  EntityRef,
  Date,
  RichText,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionDef {
  pub id: String,
  pub label: String,
  pub target_type: ActionTarget,
  pub handler_hint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ActionTarget {
  Entity { entity_type: String },
  Relation { relation_type: String },
  Global,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewDef {
  pub id: String,
  pub name: String,
  pub target_entity_type: String,
  pub layout: ViewLayout,
  pub fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ViewLayout {
  Card,
  Table,
  Form,
  Detail,
  List,
  Custom(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaChanges {
  pub add_fields: Vec<FieldDef>,
  pub remove_fields: Vec<String>,
  pub modify_fields: Vec<FieldModify>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldModify {
  pub name: String,
  pub new_label: Option<String>,
  pub new_required: Option<bool>,
  pub new_options: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewChanges {
  pub name: Option<String>,
  pub layout: Option<ViewLayout>,
  pub add_fields: Vec<String>,
  pub remove_fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationTypeChanges {
  pub new_source_types: Option<Vec<String>>,
  pub new_target_types: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionChanges {
  pub new_label: Option<String>,
  pub new_handler_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeDef {
  pub id: String,
  pub name: String,
  pub colors: ThemeColors,
  pub typography: TypographyDef,
  pub spacing: SpacingDef,
  pub border_radius: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeColors {
  pub primary: String,
  pub secondary: String,
  pub background: String,
  pub surface: String,
  pub text: String,
  pub text_secondary: String,
  pub accent: String,
  pub error: String,
  pub warning: String,
  pub success: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypographyDef {
  pub font_family: String,
  pub heading_size: String,
  pub body_size: String,
  pub caption_size: String,
  pub line_height: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpacingDef {
  pub xs: String,
  pub sm: String,
  pub md: String,
  pub lg: String,
  pub xl: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeChanges {
  pub name: Option<String>,
  pub colors: Option<ThemeColors>,
  pub typography: Option<TypographyDef>,
  pub spacing: Option<SpacingDef>,
  pub border_radius: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutDef {
  pub id: String,
  pub name: String,
  pub target: LayoutTarget,
  pub structure: LayoutStructure,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LayoutTarget {
  Page { page_id: String },
  Panel { panel_id: String },
  Component { component_id: String },
  Global,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutStructure {
  pub direction: LayoutDirection,
  pub gap: String,
  pub padding: String,
  pub sections: Vec<LayoutSection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LayoutDirection {
  Row,
  Column,
  Grid { columns: usize },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutSection {
  pub id: String,
  pub name: String,
  pub min_width: Option<String>,
  pub max_width: Option<String>,
  pub grow: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutChanges {
  pub name: Option<String>,
  pub structure: Option<LayoutStructure>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleDef {
  pub target: StyleTarget,
  pub properties: Vec<StyleProperty>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StyleTarget {
  Component { component_id: String },
  Element { selector: String },
  CssVariable { variable_name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleProperty {
  pub property: String,
  pub value: String,
  pub important: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RetrofitIntent {
  AddView { entity_type: String, view: ViewDef },
  ModifyView { view_id: String, changes: ViewChanges },
  RemoveView { view_id: String },
  AddField { entity_type: String, field: FieldDef },
  ModifyField { entity_type: String, field_name: String, changes: FieldModify },
  RemoveField { entity_type: String, field_name: String },
  AddAction { target: ActionTarget, action: ActionDef },
  ModifyAction { action_id: String, changes: ActionChanges },
  RemoveAction { action_id: String },
  ModifySchema { entity_type: String, changes: SchemaChanges },
  AddEntityType { type_name: String, fields: Vec<FieldDef> },
  RemoveEntityType { type_name: String },
  AddRelationType { type_name: String, source_types: Vec<String>, target_types: Vec<String> },
  ModifyRelationType { type_name: String, changes: RelationTypeChanges },
  RemoveRelationType { type_name: String },
  SetTheme { theme: ThemeDef },
  ModifyTheme { theme_id: String, changes: ThemeChanges },
  ModifyLayout { layout: LayoutDef },
  ModifyStyle { style: StyleDef },
}
