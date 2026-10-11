use worldsea_core::workflow::types::{WorkflowDefinition, NodeDefinition, EdgeDefinition};
use worldsea_core::workflow::parser::{parse_definition, ParseFormat};
use worldsea_core::workflow::validator::{validate_definition, ValidationError};
use serde_json::json;

#[test]
fn test_workflow_definition_roundtrip() {
    let def = WorkflowDefinition {
        id: "wf-1".to_string(),
        name: "Test Workflow".to_string(),
        version: 1,
        description: Some("A test".to_string()),
        category: "custom".to_string(),
        params: None,
        timeout_ms: None,
        nodes: vec![NodeDefinition {
            id: "n1".to_string(),
            type_: "start".to_string(),
            config: json!({}),
            position: None,
            error_handling: None,
            timeout_ms: None,
            sub_graph: None,
        }],
        edges: vec![],
        schema_version: 1,
    };
    let json = serde_json::to_string(&def).unwrap();
    let parsed: WorkflowDefinition = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.id, "wf-1");
    assert_eq!(parsed.nodes.len(), 1);
}

#[test]
fn test_edge_definition_serialize() {
    let edge = EdgeDefinition {
        from: "n1".to_string(),
        to: "n2".to_string(),
        label: Some("yes".to_string()),
        condition: None,
    };
    let json = serde_json::to_string(&edge).unwrap();
    assert!(json.contains("\"from\":\"n1\""));
    assert!(json.contains("\"label\":\"yes\""));
}

#[test]
fn test_parse_json_definition() {
    let src = r#"{
        "id": "wf-1",
        "name": "Test",
        "version": 1,
        "category": "custom",
        "nodes": [{"id": "n1", "type": "start", "config": {}}],
        "edges": []
    }"#;
    let def = parse_definition(src, ParseFormat::Json).unwrap();
    assert_eq!(def.id, "wf-1");
}

#[test]
fn test_parse_yaml_definition() {
    let src = r#"
id: wf-1
name: Test
version: 1
category: custom
nodes:
  - id: n1
    type: start
    config: {}
edges: []
"#;
    let def = parse_definition(src, ParseFormat::Yaml).unwrap();
    assert_eq!(def.id, "wf-1");
    assert_eq!(def.nodes.len(), 1);
}

#[test]
fn test_parse_invalid_raises() {
    let result = parse_definition("not valid", ParseFormat::Json);
    assert!(result.is_err());
}

// ─────────────────────────────────────────────────────────────────────────────
// Validator
// ─────────────────────────────────────────────────────────────────────────────

fn make_simple_def() -> WorkflowDefinition {
    WorkflowDefinition {
        id: "wf-1".to_string(),
        name: "Test".to_string(),
        version: 1,
        description: None,
        category: "custom".to_string(),
        params: None,
        timeout_ms: None,
        nodes: vec![
            NodeDefinition {
                id: "n1".to_string(),
                type_: "start".to_string(),
                config: json!({}),
                position: None,
                error_handling: None,
                timeout_ms: None,
                sub_graph: None,
            },
            NodeDefinition {
                id: "n2".to_string(),
                type_: "end".to_string(),
                config: json!({}),
                position: None,
                error_handling: None,
                timeout_ms: None,
                sub_graph: None,
            },
        ],
        edges: vec![EdgeDefinition {
            from: "n1".to_string(),
            to: "n2".to_string(),
            label: None,
            condition: None,
        }],
        schema_version: 1,
    }
}

#[test]
fn test_valid_definition() {
    let def = make_simple_def();
    assert!(validate_definition(&def).is_ok());
}

#[test]
fn test_no_start_node() {
    let mut def = make_simple_def();
    def.nodes[0].type_ = "skill".to_string();
    let result = validate_definition(&def);
    assert!(matches!(result, Err(ValidationError::NoStartNode)));
}

#[test]
fn test_no_end_node() {
    let mut def = make_simple_def();
    def.nodes[1].type_ = "skill".to_string();
    let result = validate_definition(&def);
    assert!(matches!(result, Err(ValidationError::NoEndNode)));
}

#[test]
fn test_cycle_detection() {
    let mut def = make_simple_def();
    def.nodes.push(NodeDefinition {
        id: "n3".to_string(),
        type_: "skill".to_string(),
        config: json!({}),
        position: None,
        error_handling: None,
        timeout_ms: None,
        sub_graph: None,
    });
    def.edges.push(EdgeDefinition {
        from: "n2".to_string(),
        to: "n3".to_string(),
        label: None,
        condition: None,
    });
    def.edges.push(EdgeDefinition {
        from: "n3".to_string(),
        to: "n1".to_string(),
        label: None,
        condition: None,
    });
    let result = validate_definition(&def);
    assert!(matches!(result, Err(ValidationError::CycleDetected(_))));
}

#[test]
fn test_orphan_node() {
    let mut def = make_simple_def();
    def.nodes.push(NodeDefinition {
        id: "n3".to_string(),
        type_: "skill".to_string(),
        config: json!({}),
        position: None,
        error_handling: None,
        timeout_ms: None,
        sub_graph: None,
    });
    // n3 不在 n1→n2 的路径上
    let result = validate_definition(&def);
    assert!(matches!(result, Err(ValidationError::OrphanNode(_))));
}
