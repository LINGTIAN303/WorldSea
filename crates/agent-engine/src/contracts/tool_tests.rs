//! ToolDescriptor 契约用例（兄弟测试文件——`tool.rs` 保持 400 行上限内）

use super::*;

fn sample_safety() -> ToolSafety {
    ToolSafety {
        read_only: false,
        destructive: false,
        concurrent_safe: false,
        requires_user_interaction: false,
        always_ask: true,
        needs_approval: false,
        risk_level: RiskLevel::Moderate,
        side_effect_scope: SideEffectScope::System,
    }
}

#[test]
fn descriptor_roundtrip_snake_case_and_required_fields() {
    let d = ToolDescriptor::new("execute_command", "dev", "执行命令", sample_safety())
        .with_input_schema(serde_json::json!({ "type": "object" }))
        .with_executor(Executor::Client);
    let v = serde_json::to_value(&d).unwrap();
    // 字段为 snake_case，分组嵌套（与生成物同形）
    assert_eq!(v["safety"]["always_ask"], true);
    assert_eq!(v["safety"]["risk_level"], "moderate");
    assert_eq!(v["safety"]["side_effect_scope"], "system");
    assert_eq!(v["executor"], "client");
    let back: ToolDescriptor = serde_json::from_value(v).unwrap();
    assert_eq!(back, d);
}

#[test]
fn enum_as_str_matches_serde_wire_names() {
    // as_str 是「展示用线面串」的第二定义处——必须与 serde 口径逐字一致（防漂移）
    for (v, wire) in [
        (RiskLevel::Safe, "safe"),
        (RiskLevel::Moderate, "moderate"),
        (RiskLevel::Dangerous, "dangerous"),
    ] {
        assert_eq!(serde_json::to_value(v).unwrap(), serde_json::json!(wire));
        assert_eq!(v.as_str(), wire);
    }
    for (v, wire) in [
        (SideEffectScope::None, "none"),
        (SideEffectScope::Workspace, "workspace"),
        (SideEffectScope::Git, "git"),
        (SideEffectScope::Network, "network"),
        (SideEffectScope::System, "system"),
        (SideEffectScope::Session, "session"),
    ] {
        assert_eq!(serde_json::to_value(v).unwrap(), serde_json::json!(wire));
        assert_eq!(v.as_str(), wire);
    }
}

#[test]
fn missing_safety_field_fails_loud() {
    // 反证①：声明缺 side_effect_scope → 解析失败（fail loud，不静默补默认）
    let raw = serde_json::json!({
        "name": "x", "aliases": [], "category": "dev", "description": "d",
        "input_schema": { "type": "object" },
        "safety": {
            "read_only": false, "destructive": false, "concurrent_safe": false,
            "requires_user_interaction": false, "always_ask": false, "needs_approval": false,
            "risk_level": "moderate"
        },
        "control": { "stop_turn_on_success": false, "provider_visible": true },
        "executor": "local"
    });
    let err = serde_json::from_value::<ToolDescriptor>(raw).unwrap_err();
    assert!(err.to_string().contains("side_effect_scope"), "{err}");
}

#[test]
fn unknown_field_fails_loud() {
    // deny_unknown_fields：生成物与契约漂移（多字段）即启动失败
    let mut v = serde_json::to_value(ToolDescriptor::read_only(
        "list_directory",
        "file",
        "列目录",
        SideEffectScope::Workspace,
    ))
    .unwrap();
    v.as_object_mut().unwrap().insert("legacy_field".into(), serde_json::json!(1));
    assert!(serde_json::from_value::<ToolDescriptor>(v).is_err());
}

#[test]
fn validate_enforces_dangerous_implies_always_ask() {
    let mut d = ToolDescriptor::read_only("list_directory", "file", "列目录", SideEffectScope::Workspace);
    assert!(d.validate().is_ok());
    d.safety.risk_level = RiskLevel::Dangerous;
    let err = d.validate().unwrap_err();
    assert!(err.contains("always_ask"), "{err}");
    // read_only 与 destructive 互斥
    d.safety.risk_level = RiskLevel::Safe;
    d.safety.read_only = true;
    d.safety.destructive = true;
    assert!(d.validate().is_err());
}
