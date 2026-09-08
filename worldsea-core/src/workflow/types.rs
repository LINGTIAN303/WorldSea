use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum NodeProtocol {
    Sync,
    Stream,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WorkflowParam {
    #[serde(rename = "type")]
    pub type_: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub default: Option<serde_json::Value>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NodePosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ErrorHandlingConfig {
    pub on_failure: String,  // 'retry' | 'skip' | 'abort' | 'agent_decision' | 'fallback'
    #[serde(default)]
    pub max_retries: Option<u32>,
    #[serde(default)]
    pub retry_delay_ms: Option<u64>,
    #[serde(default)]
    pub fallback: Option<Box<NodeDefinition>>,
    #[serde(default)]
    pub agent_prompt: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NodeDefinition {
    pub id: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub config: serde_json::Value,
    #[serde(default)]
    pub position: Option<NodePosition>,
    #[serde(default)]
    pub error_handling: Option<ErrorHandlingConfig>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub sub_graph: Option<SubGraph>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SubGraph {
    pub nodes: Vec<NodeDefinition>,
    pub edges: Vec<EdgeDefinition>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct EdgeDefinition {
    pub from: String,
    pub to: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub condition: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WorkflowDefinition {
    pub id: String,
    pub name: String,
    pub version: u32,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default = "default_category")]
    pub category: String,
    #[serde(default)]
    pub params: Option<BTreeMap<String, WorkflowParam>>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    pub nodes: Vec<NodeDefinition>,
    pub edges: Vec<EdgeDefinition>,
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
}

fn default_category() -> String { "custom".to_string() }
fn default_schema_version() -> u32 { 1 }
