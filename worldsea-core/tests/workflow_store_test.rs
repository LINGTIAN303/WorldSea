use worldsea_core::storage::sqlite::SqliteStore;
use worldsea_core::storage::workflow::{RunSummary, WorkflowStore};
use worldsea_core::workflow::types::{
    EdgeDefinition, NodeDefinition, WorkflowDefinition,
};
use serde_json::json;

fn make_test_store() -> SqliteStore {
    SqliteStore::open_in_memory().expect("open in-memory store")
}

fn make_test_def(id: &str) -> WorkflowDefinition {
    WorkflowDefinition {
        id: id.to_string(),
        name: format!("Workflow {id}"),
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
fn test_save_and_get_workflow() {
    let store = make_test_store();
    let def = make_test_def("wf-1");
    store
        .with_conn(|c| WorkflowStore::new(c).save(&def))
        .unwrap();
    let loaded = store.with_conn(|c| WorkflowStore::new(c).get("wf-1")).unwrap();
    assert_eq!(loaded.name, "Workflow wf-1");
    assert_eq!(loaded.version, 1);
    assert_eq!(loaded.nodes.len(), 2);
}

#[test]
fn test_save_new_version_increments() {
    let store = make_test_store();
    let mut def = make_test_def("wf-1");
    store.with_conn(|c| WorkflowStore::new(c).save(&def)).unwrap();
    def.version = 2;
    def.name = "Updated".to_string();
    store.with_conn(|c| WorkflowStore::new(c).save(&def)).unwrap();
    let loaded = store.with_conn(|c| WorkflowStore::new(c).get("wf-1")).unwrap();
    assert_eq!(loaded.version, 2);
    assert_eq!(loaded.name, "Updated");
    let versions = store
        .with_conn(|c| WorkflowStore::new(c).list_versions("wf-1"))
        .unwrap();
    assert_eq!(versions.len(), 2);
    assert_eq!(versions[0], 2);
    assert_eq!(versions[1], 1);
}

#[test]
fn test_list_workflows() {
    let store = make_test_store();
    store
        .with_conn(|c| WorkflowStore::new(c).save(&make_test_def("wf-1")))
        .unwrap();
    store
        .with_conn(|c| WorkflowStore::new(c).save(&make_test_def("wf-2")))
        .unwrap();
    let list = store
        .with_conn(|c| WorkflowStore::new(c).list(None, None, 10))
        .unwrap();
    assert_eq!(list.len(), 2);
    // updated_at 用毫秒时间戳，相邻两条可能相同，因此不依赖具体顺序
    let ids: std::collections::HashSet<&str> = list.iter().map(|s| s.id.as_str()).collect();
    assert!(ids.contains("wf-1"));
    assert!(ids.contains("wf-2"));
}

#[test]
fn test_delete_workflow_blocked_if_runs_exist() {
    let store = make_test_store();
    store
        .with_conn(|c| WorkflowStore::new(c).save(&make_test_def("wf-1")))
        .unwrap();
    let _run_id = store
        .with_conn(|c| WorkflowStore::new(c).create_run("wf-1", 1, "user", json!({})))
        .unwrap();
    let result = store.with_conn(|c| WorkflowStore::new(c).delete("wf-1"));
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("运行记录"), "error should mention runs: {err}");
}

#[test]
fn test_purge_old_runs() {
    let store = make_test_store();
    store
        .with_conn(|c| WorkflowStore::new(c).save(&make_test_def("wf-1")))
        .unwrap();

    // 100 天前完成
    let run_id = store
        .with_conn(|c| WorkflowStore::new(c).create_run("wf-1", 1, "user", json!({})))
        .unwrap();
    store
        .with_conn(|c| WorkflowStore::new(c).update_run_status(&run_id, "completed", Some(0)))
        .unwrap();

    // 1 天前完成
    let run_id2 = store
        .with_conn(|c| WorkflowStore::new(c).create_run("wf-1", 1, "user", json!({})))
        .unwrap();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    store
        .with_conn(|c| {
            WorkflowStore::new(c).update_run_status(&run_id2, "completed", Some(now - 86_400_000))
        })
        .unwrap();

    // 30 天保留：100 天前的应被清，1 天前的保留
    let purged = store
        .with_conn(|c| WorkflowStore::new(c).purge_old_runs(30))
        .unwrap();
    assert_eq!(purged, 1);
    let remaining: Vec<RunSummary> = store
        .with_conn(|c| WorkflowStore::new(c).list_runs(None, None, 100))
        .unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].run_id, run_id2);
}
