use worldsea_core::doctor::diagnostics::run_diagnostics;
use worldsea_core::migrate::engine::migrate_pack;
use worldsea_core::models::entity::{Entity, EntityTypeSchema, FieldSchema};
use worldsea_core::models::pack::{WorldSeaManifest, WorldSeaPack, PACK_VERSION};
use worldsea_core::models::plugin::{validate_manifest, PluginManifest};
use worldsea_core::models::relation::Relation;
use worldsea_core::validate::entity::validate_entity;
use worldsea_core::validate::pack::validate_pack;
use worldsea_core::validate::reference::check_references;
use worldsea_core::validate::relation::validate_relation;

fn make_entity(id: &str, etype: &str) -> Entity {
  Entity {
    id: id.to_string(),
    entity_type: etype.to_string(),
    name: format!("实体{id}"),
    description: "描述".to_string(),
    properties: serde_json::json!({"age": 25}),
    tags: vec!["tag1".to_string()],
    avatar: None,
    created_at: "2024-01-01".to_string(),
    updated_at: "2024-01-01".to_string(),
  }
}

fn make_relation(id: &str, rtype: &str, source: &str, target: &str) -> Relation {
  Relation {
    id: id.to_string(),
    relation_type: rtype.to_string(),
    source_id: source.to_string(),
    target_id: target.to_string(),
    label: None,
    properties: serde_json::json!({}),
    pair_id: None,
    created_at: "2024-01-01".to_string(),
    updated_at: "2024-01-01".to_string(),
  }
}

#[test]
fn test_full_workflow() {
  let e1 = make_entity("e1", "character");
  let e2 = make_entity("e2", "region");

  let report = validate_entity(&e1, None);
  assert!(report.valid);

  let r1 = make_relation("r1", "located_in", "e1", "e2");
  let rel_report = validate_relation(&r1, None);
  assert!(rel_report.valid);

  let entities = vec![e1.clone(), e2.clone()];
  let relations = vec![r1.clone()];
  let ref_result = check_references(&entities, &relations);
  assert!(ref_result.dangling_relations.is_empty());
  assert!(ref_result.orphan_entities.is_empty());

  let schema = EntityTypeSchema {
    type_name: "character".to_string(),
    label: "人物".to_string(),
    icon: None,
    fields: vec![FieldSchema {
      key: "age".to_string(),
      label: "年龄".to_string(),
      field_type: "number".to_string(),
      required: Some(true),
      default_value: None,
      options: None,
      placeholder: None,
      ref_type: None,
      relation_type: None,
      auto_link: None,
    }],
    custom_fields: None,
    plugin_id: None,
  };

  let diag = run_diagnostics(&entities, &relations, Some(&vec![schema]));
  assert_eq!(diag.total_entities, 2);
  assert_eq!(diag.total_relations, 1);
}

#[test]
fn test_migration_workflow() {
  let mut pack_data = serde_json::json!({
      "manifest": {"version": 1, "exportedAt": "2024-01-01"},
      "serializers": {}
  });

  let result = migrate_pack(&mut pack_data, 1);
  assert!(result.success);
  assert_eq!(result.to_version, 2);
}

#[test]
fn test_plugin_manifest_validation() {
  let manifest = PluginManifest {
    id: "official.characters".to_string(),
    name: "人物志".to_string(),
    version: "1.0.0".to_string(),
    description: "人物管理插件".to_string(),
    author: Some("WorldSea".to_string()),
    permissions: vec![],
    dependencies: vec![],
    entity_types: vec!["character".to_string()],
    relation_types: vec!["knows".to_string()],
    views: vec!["characters".to_string()],
  };

  let result = validate_manifest(&manifest);
  assert!(result.valid);
  assert!(result.errors.is_empty());
}

#[cfg(feature = "sqlite")]
mod sqlite_integration {
  use worldsea_core::doctor::storage::check_storage_health;
  use worldsea_core::models::entity::Entity;
  use worldsea_core::models::relation::Relation;
  use worldsea_core::storage::sqlite::SqliteStore;
  use worldsea_core::storage::StorageBackend;

  fn make_entity(id: &str, etype: &str) -> Entity {
    Entity {
      id: id.to_string(),
      entity_type: etype.to_string(),
      name: format!("实体{id}"),
      description: "描述".to_string(),
      properties: serde_json::json!({}),
      tags: vec![],
      avatar: None,
      created_at: "2024-01-01".to_string(),
      updated_at: "2024-01-01".to_string(),
    }
  }

  fn make_relation(id: &str, rtype: &str, source: &str, target: &str) -> Relation {
    Relation {
      id: id.to_string(),
      relation_type: rtype.to_string(),
      source_id: source.to_string(),
      target_id: target.to_string(),
      label: None,
      properties: serde_json::json!({}),
      pair_id: None,
      created_at: "2024-01-01".to_string(),
      updated_at: "2024-01-01".to_string(),
    }
  }

  #[test]
  fn test_sqlite_full_workflow() {
    let store = SqliteStore::open_in_memory().unwrap();

    store.put_entity(&make_entity("e1", "character")).unwrap();
    store.put_entity(&make_entity("e2", "region")).unwrap();
    store.put_relation(&make_relation("r1", "located_in", "e1", "e2")).unwrap();

    let health = check_storage_health(&store as &dyn StorageBackend);
    assert_eq!(health.status, "healthy");
    assert_eq!(health.entity_count, 2);
    assert_eq!(health.relation_count, 1);
    assert!(health.integrity_ok);

    store.kv_set("app_version", "1.0.0").unwrap();
    let val = store.kv_get("app_version").unwrap();
    assert_eq!(val, Some("1.0.0".to_string()));

    let entities = store.get_all_entities().unwrap();
    let relations = store.get_all_relations().unwrap();

    let ref_result = worldsea_core::validate::reference::check_references(&entities, &relations);
    assert!(ref_result.dangling_relations.is_empty());
  }

  #[test]
  fn test_storage_backend_trait() {
    let store = SqliteStore::open_in_memory().unwrap();
    let backend: &dyn StorageBackend = &store;

    let entity = make_entity("e1", "character");
    backend.put_entity(&entity).unwrap();
    let got = backend.get_entity("e1").unwrap();
    assert!(got.is_some());

    let relation = make_relation("r1", "knows", "e1", "e2");
    backend.put_relation(&relation).unwrap();
    let got_rel = backend.get_relation("r1").unwrap();
    assert!(got_rel.is_some());

    backend.kv_set("key1", "val1").unwrap();
    assert_eq!(backend.kv_get("key1").unwrap(), Some("val1".to_string()));
  }
}

#[cfg(feature = "sqlite")]
mod retrofit_e2e {
  use worldsea_core::retrofit::catalog::CapabilityCatalog;
  use worldsea_core::retrofit::executor::OwnedSqliteExecutor;
  use worldsea_core::retrofit::intent::{
    FieldDef, FieldType, LayoutDef, LayoutDirection, LayoutSection, LayoutStructure, LayoutTarget,
    RetrofitIntent, SpacingDef, StyleDef, StyleProperty, StyleTarget, ThemeChanges, ThemeColors,
    ThemeDef, TypographyDef,
  };
  use worldsea_core::retrofit::patch::JsonPatchDiff;
  use worldsea_core::retrofit::session::SessionPhase;
  use worldsea_core::retrofit::RetrofitEngine;
  use worldsea_core::storage::sqlite::SqliteStore;

  fn dark_theme() -> ThemeDef {
    ThemeDef {
      id: "dark".to_string(),
      name: "暗黑主题".to_string(),
      colors: ThemeColors {
        primary: "#6750A4".to_string(),
        secondary: "#625B71".to_string(),
        background: "#1C1B1F".to_string(),
        surface: "#2B2930".to_string(),
        text: "#E6E1E5".to_string(),
        text_secondary: "#CAC4D0".to_string(),
        accent: "#D0BCFF".to_string(),
        error: "#F2B8B5".to_string(),
        warning: "#F9DEDC".to_string(),
        success: "#A8DAB5".to_string(),
      },
      typography: TypographyDef {
        font_family: "Inter".to_string(),
        heading_size: "24px".to_string(),
        body_size: "14px".to_string(),
        caption_size: "12px".to_string(),
        line_height: "1.5".to_string(),
      },
      spacing: SpacingDef {
        xs: "4px".to_string(),
        sm: "8px".to_string(),
        md: "16px".to_string(),
        lg: "24px".to_string(),
        xl: "32px".to_string(),
      },
      border_radius: "8px".to_string(),
    }
  }

  macro_rules! make_engine {
    ($storage:expr) => {{
      let executor = OwnedSqliteExecutor::new($storage);
      RetrofitEngine::with_executor(Box::new(executor))
    }};
  }

  macro_rules! apply_all {
    ($engine:expr) => {
      while $engine.apply_next(serde_json::json!({}), serde_json::json!({})).unwrap().is_some() {}
    };
  }

  #[test]
  fn test_retrofit_full_lifecycle_data_and_style() {
    let storage = SqliteStore::open_in_memory().unwrap();
    let mut engine = make_engine!(storage);
    let catalog = CapabilityCatalog::permissive();

    engine.begin_session("e2e-001", catalog).unwrap();
    assert_eq!(engine.session().unwrap().phase, SessionPhase::Negotiate);

    let add_intent = RetrofitIntent::AddEntityType {
      type_name: "character".to_string(),
      fields: vec![FieldDef {
        name: "name".to_string(),
        field_type: FieldType::Text,
        label: "名称".to_string(),
        required: true,
        default_value: None,
        options: None,
      }],
    };
    let report = engine.submit_intent(add_intent).unwrap();
    assert!(report.allowed);

    let theme_intent = RetrofitIntent::SetTheme { theme: dark_theme() };
    let theme_report = engine.submit_intent(theme_intent).unwrap();
    assert!(theme_report.allowed);

    let layout_intent = RetrofitIntent::ModifyLayout {
      layout: LayoutDef {
        id: "main".to_string(),
        name: "主布局".to_string(),
        target: LayoutTarget::Global,
        structure: LayoutStructure {
          direction: LayoutDirection::Column,
          gap: "16px".to_string(),
          padding: "24px".to_string(),
          sections: vec![LayoutSection {
            id: "content".to_string(),
            name: "内容区".to_string(),
            min_width: None,
            max_width: None,
            grow: Some(1.0),
          }],
        },
      },
    };
    let layout_report = engine.submit_intent(layout_intent).unwrap();
    assert!(layout_report.allowed);

    let style_intent = RetrofitIntent::ModifyStyle {
      style: StyleDef {
        target: StyleTarget::Component { component_id: "hero-card".to_string() },
        properties: vec![StyleProperty {
          property: "background-color".to_string(),
          value: "#1a1a2e".to_string(),
          important: false,
        }],
      },
    };
    let style_report = engine.submit_intent(style_intent).unwrap();
    assert!(style_report.allowed);

    let confirm_result = engine.confirm_and_stage().unwrap();
    assert_eq!(confirm_result.confirmed_count, 4);
    assert!(!confirm_result.conflicts.has_conflicts);
    assert_eq!(engine.session().unwrap().phase, SessionPhase::Staging);

    let mut apply_results = Vec::new();
    while let Some(result) =
      engine.apply_next(serde_json::json!({}), serde_json::json!({})).unwrap()
    {
      assert!(result.execution.success, "执行失败: {:?}", result.execution);
      apply_results.push(result);
    }
    assert_eq!(apply_results.len(), 4);
    assert_eq!(engine.session().unwrap().phase, SessionPhase::Verifying);

    let verify_result = engine.verify_and_accept(1, 0).unwrap();
    assert_eq!(verify_result.changes_applied, 4);
    assert_eq!(verify_result.changes_rolled_back, 0);
    assert_eq!(verify_result.session_id, "e2e-001");
  }

  #[test]
  fn test_retrofit_modify_theme_then_patch() {
    let storage = SqliteStore::open_in_memory().unwrap();
    let mut engine = make_engine!(storage);
    let catalog = CapabilityCatalog::permissive();

    engine.begin_session("e2e-theme-001", catalog).unwrap();

    engine.submit_intent(RetrofitIntent::SetTheme { theme: dark_theme() }).unwrap();

    let modify_intent = RetrofitIntent::ModifyTheme {
      theme_id: "dark".to_string(),
      changes: ThemeChanges {
        name: Some("暗黑主题v2".to_string()),
        colors: None,
        typography: None,
        spacing: None,
        border_radius: Some("12px".to_string()),
      },
    };
    engine.submit_intent(modify_intent).unwrap();

    let confirm = engine.confirm_and_stage().unwrap();
    assert_eq!(confirm.confirmed_count, 2);

    apply_all!(engine);

    let result = engine.verify_and_accept(1, 0).unwrap();
    assert_eq!(result.changes_applied, 2);

    let before = serde_json::json!({"colors": {"primary": "#6750A4"}, "borderRadius": "12px"});
    let after = serde_json::json!({"colors": {"primary": "#FF0000"}, "borderRadius": "16px"});
    let patch = JsonPatchDiff::diff(&before, &after);
    assert_eq!(patch.len(), 2);
    let patched = patch.apply(&before).unwrap();
    assert_eq!(patched["colors"]["primary"], "#FF0000");
    assert_eq!(patched["borderRadius"], "16px");
  }

  #[test]
  fn test_retrofit_redirect_clears_intents() {
    let storage = SqliteStore::open_in_memory().unwrap();
    let mut engine = make_engine!(storage);
    let catalog = CapabilityCatalog::permissive();

    engine.begin_session("e2e-redirect", catalog).unwrap();

    let report = engine
      .submit_intent(RetrofitIntent::AddEntityType {
        type_name: "character".to_string(),
        fields: vec![FieldDef {
          name: "name".to_string(),
          field_type: FieldType::Text,
          label: "名称".to_string(),
          required: true,
          default_value: None,
          options: None,
        }],
      })
      .unwrap();
    assert!(report.allowed, "意图被拦截: {:?}", report.blocked_reason);

    let confirm = engine.confirm_and_stage().unwrap();
    assert_eq!(confirm.confirmed_count, 1);

    engine.redirect("改主意了").unwrap();
    assert_eq!(engine.session().unwrap().phase, SessionPhase::Negotiate);
    assert!(engine.session().unwrap().confirmed_intents.is_empty());

    engine.submit_intent(RetrofitIntent::SetTheme { theme: dark_theme() }).unwrap();
    let confirm2 = engine.confirm_and_stage().unwrap();
    assert_eq!(confirm2.confirmed_count, 1);

    apply_all!(engine);
    let result = engine.verify_and_accept(1, 0).unwrap();
    assert_eq!(result.changes_applied, 1);
  }

  #[test]
  fn test_retrofit_abort_rolls_back() {
    let storage = SqliteStore::open_in_memory().unwrap();
    let mut engine = make_engine!(storage);
    let catalog = CapabilityCatalog::permissive();

    engine.begin_session("e2e-abort", catalog).unwrap();

    engine
      .submit_intent(RetrofitIntent::AddEntityType {
        type_name: "item".to_string(),
        fields: vec![FieldDef {
          name: "title".to_string(),
          field_type: FieldType::Text,
          label: "标题".to_string(),
          required: true,
          default_value: None,
          options: None,
        }],
      })
      .unwrap();

    engine.confirm_and_stage().unwrap();
    apply_all!(engine);

    let rolled = engine.abort().unwrap();
    assert_eq!(rolled.len(), 1);
  }

  #[test]
  fn test_retrofit_conflict_detection() {
    let storage = SqliteStore::open_in_memory().unwrap();
    let mut engine = make_engine!(storage);
    let catalog = CapabilityCatalog::permissive();

    engine.begin_session("e2e-conflict", catalog).unwrap();

    engine
      .submit_intent(RetrofitIntent::AddEntityType {
        type_name: "quest".to_string(),
        fields: vec![FieldDef {
          name: "title".to_string(),
          field_type: FieldType::Text,
          label: "标题".to_string(),
          required: true,
          default_value: None,
          options: None,
        }],
      })
      .unwrap();

    engine
      .submit_intent(RetrofitIntent::RemoveEntityType { type_name: "quest".to_string() })
      .unwrap();

    let confirm = engine.confirm_and_stage().unwrap();
    assert!(confirm.conflicts.has_conflicts);
    assert!(!confirm.conflicts.conflicts.is_empty());
  }

  #[test]
  fn test_retrofit_custom_health_check() {
    let storage = SqliteStore::open_in_memory().unwrap();
    let mut engine = make_engine!(storage);
    let catalog = CapabilityCatalog::permissive();

    engine.register_health_check(Box::new(|_changelog, entity_count, _relation_count| {
      if entity_count > 100 {
        vec!["实体数量超过 100，可能有性能问题".to_string()]
      } else {
        vec![]
      }
    }));

    engine.begin_session("e2e-health", catalog.clone()).unwrap();
    engine.submit_intent(RetrofitIntent::SetTheme { theme: dark_theme() }).unwrap();
    engine.confirm_and_stage().unwrap();
    apply_all!(engine);

    let result = engine.verify_and_accept(50, 10).unwrap();
    assert!(result.health_check.unwrap().healthy);

    engine.end_session();

    engine.begin_session("e2e-health2", catalog).unwrap();
    engine
      .submit_intent(RetrofitIntent::ModifyStyle {
        style: StyleDef {
          target: StyleTarget::Component { component_id: "test".to_string() },
          properties: vec![StyleProperty {
            property: "color".to_string(),
            value: "red".to_string(),
            important: false,
          }],
        },
      })
      .unwrap();
    engine.confirm_and_stage().unwrap();
    apply_all!(engine);

    let result2 = engine.verify_and_accept(200, 10).unwrap();
    assert!(!result2.health_check.unwrap().healthy);
  }

  #[test]
  fn test_retrofit_double_session_blocked() {
    let storage = SqliteStore::open_in_memory().unwrap();
    let mut engine = make_engine!(storage);
    let catalog = CapabilityCatalog::permissive();

    engine.begin_session("session-1", catalog.clone()).unwrap();
    let result = engine.begin_session("session-2", catalog);
    assert!(result.is_err());
  }

  #[test]
  fn test_retrofit_patch_diff_roundtrip_in_session() {
    let storage = SqliteStore::open_in_memory().unwrap();
    let mut engine = make_engine!(storage);
    let catalog = CapabilityCatalog::permissive();

    engine.begin_session("e2e-patch", catalog).unwrap();

    let before_theme = serde_json::json!({
      "id": "light",
      "name": "亮色",
      "colors": {"primary": "#000", "background": "#fff"},
      "borderRadius": "4px"
    });
    let after_theme = serde_json::json!({
      "id": "light",
      "name": "亮色v2",
      "colors": {"primary": "#6750A4", "background": "#fff"},
      "borderRadius": "8px"
    });

    let patch = JsonPatchDiff::diff(&before_theme, &after_theme);
    assert!(patch.len() < 4);

    let estimate = JsonPatchDiff::estimate_token_saving(&before_theme, &after_theme);
    assert!(estimate.operation_count > 0);

    let patched = patch.apply(&before_theme).unwrap();
    assert_eq!(patched, after_theme);

    engine.submit_intent(RetrofitIntent::SetTheme { theme: dark_theme() }).unwrap();
    engine.confirm_and_stage().unwrap();
    apply_all!(engine);
    let result = engine.verify_and_accept(1, 0).unwrap();
    assert_eq!(result.changes_applied, 1);
  }
}

#[test]
fn test_validate_pack_workflow() {
  let pack = WorldSeaPack {
    manifest: WorldSeaManifest {
      version: PACK_VERSION,
      exported_at: "2024-01-01".to_string(),
      app_version: None,
      description: None,
    },
    serializers: serde_json::json!({"entities": []}),
  };
  let report = validate_pack(&pack);
  assert!(report.valid);
}

#[test]
fn test_diagnostics_workflow() {
  let entities = vec![make_entity("e1", "character"), make_entity("e2", "region")];
  let relations = vec![make_relation("r1", "located_in", "e1", "e2")];
  let diag = run_diagnostics(&entities, &relations, None);
  assert_eq!(diag.total_entities, 2);
  assert_eq!(diag.total_relations, 1);
  assert_eq!(diag.entity_type_distribution.len(), 2);
  assert_eq!(diag.relation_type_distribution.len(), 1);
}
