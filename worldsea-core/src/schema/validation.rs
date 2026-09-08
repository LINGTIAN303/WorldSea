use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationRule {
    pub id: String,
    pub description: String,
    pub field_key: String,
    pub rule_type: ValidationRuleType,
    #[serde(default)]
    pub params: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ValidationRuleType {
    Required,
    Unique,
    Pattern,
    Range,
    Conditional,
    Custom,
}
