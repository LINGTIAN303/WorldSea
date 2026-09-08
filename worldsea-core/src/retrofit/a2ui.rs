use serde::{Deserialize, Serialize};

use crate::retrofit::session::SessionPhase;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2UIComponent {
  pub id: String,
  pub component: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub children: Option<Vec<String>>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub text: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub variant: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub label: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub value: Option<serde_json::Value>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub min: Option<f64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub max: Option<f64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub data_path: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub action: Option<A2UIAction>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub actions: Option<Vec<A2UIItemAction>>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub tags: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2UIAction {
  pub event: A2UIEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2UIEvent {
  pub name: String,
  pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2UIItemAction {
  pub name: String,
  pub label: String,
  pub variant: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2UIMessage {
  pub version: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub create_surface: Option<A2UICreateSurface>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub update_components: Option<A2UIUpdateComponents>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub update_data_model: Option<A2UIUpdateDataModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2UICreateSurface {
  pub surface_id: String,
  pub catalog_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2UIUpdateComponents {
  pub surface_id: String,
  pub components: Vec<A2UIComponent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2UIUpdateDataModel {
  pub surface_id: String,
  pub path: String,
  pub value: serde_json::Value,
}

const WS_CATALOG: &str = "https://worldsea.app/catalog/v1";

pub struct RetrofitA2UI;

impl RetrofitA2UI {
  #[must_use]
  #[allow(clippy::too_many_lines)]
  pub fn negotiate_surface(session_id: &str, intents: &[IntentSummary]) -> Vec<A2UIMessage> {
    let surface_id = format!("retrofit-{session_id}");
    let mut messages = vec![A2UIMessage {
      version: "v0.9".to_string(),
      create_surface: Some(A2UICreateSurface {
        surface_id: surface_id.clone(),
        catalog_id: WS_CATALOG.to_string(),
      }),
      update_components: None,
      update_data_model: None,
    }];

    let intent_ids: Vec<String> =
      intents.iter().enumerate().map(|(i, _)| format!("intent-{i}")).collect();
    let mut warning_ids: Vec<String> = Vec::new();
    let mut extra_components: Vec<A2UIComponent> = Vec::new();

    for (i, intent) in intents.iter().enumerate() {
      for (j, warn) in intent.warnings.iter().enumerate() {
        let warn_id = format!("warn-{i}-{j}");
        warning_ids.push(warn_id.clone());
        extra_components.push(A2UIComponent {
          id: warn_id,
          component: "Text".to_string(),
          text: Some(format!("\u{26a0} {warn}")),
          variant: Some("caption".to_string()),
          children: None,
          label: None,
          value: None,
          min: None,
          max: None,
          data_path: None,
          action: None,
          actions: None,
          tags: None,
        });
      }
    }

    let mut all_children = vec![
      "header".to_string(),
      "intent-list".to_string(),
      "warnings".to_string(),
      "actions".to_string(),
    ];
    if !warning_ids.is_empty() {
      all_children.insert(2, "warnings".to_string());
    }

    let mut components: Vec<A2UIComponent> = vec![
      A2UIComponent {
        id: "root".to_string(),
        component: "Column".to_string(),
        children: Some(all_children),
        text: None,
        variant: None,
        label: None,
        value: None,
        min: None,
        max: None,
        data_path: None,
        action: None,
        actions: None,
        tags: None,
      },
      A2UIComponent {
        id: "header".to_string(),
        component: "Text".to_string(),
        text: Some(format!("\u{1f527} 改造协商 \u{2014} {session_id}")),
        variant: Some("h3".to_string()),
        children: None,
        label: None,
        value: None,
        min: None,
        max: None,
        data_path: None,
        action: None,
        actions: None,
        tags: None,
      },
      A2UIComponent {
        id: "intent-list".to_string(),
        component: "List".to_string(),
        children: Some(intent_ids),
        text: None,
        variant: None,
        label: None,
        value: None,
        min: None,
        max: None,
        data_path: None,
        action: None,
        actions: None,
        tags: None,
      },
    ];

    for (i, _intent) in intents.iter().enumerate() {
      components.push(A2UIComponent {
        id: format!("intent-{i}"),
        component: "EntityCard".to_string(),
        data_path: Some(format!("/intents/{i}")),
        actions: Some(vec![
          A2UIItemAction {
            name: "approve".to_string(),
            label: "同意".to_string(),
            variant: "primary".to_string(),
          },
          A2UIItemAction {
            name: "reject".to_string(),
            label: "拒绝".to_string(),
            variant: "danger".to_string(),
          },
        ]),
        children: None,
        text: None,
        variant: None,
        label: None,
        value: None,
        min: None,
        max: None,
        action: None,
        tags: None,
      });
    }

    components.push(A2UIComponent {
      id: "warnings".to_string(),
      component: "Column".to_string(),
      children: Some(warning_ids),
      text: None,
      variant: None,
      label: None,
      value: None,
      min: None,
      max: None,
      data_path: None,
      action: None,
      actions: None,
      tags: None,
    });
    components.extend(extra_components);

    components.push(A2UIComponent {
      id: "actions".to_string(),
      component: "Row".to_string(),
      children: Some(vec![
        "btn-confirm".to_string(),
        "btn-redirect".to_string(),
        "btn-abort".to_string(),
      ]),
      text: None,
      variant: None,
      label: None,
      value: None,
      min: None,
      max: None,
      data_path: None,
      action: None,
      actions: None,
      tags: None,
    });
    components.push(A2UIComponent {
      id: "btn-confirm".to_string(),
      component: "Button".to_string(),
      variant: Some("primary".to_string()),
      text: Some("确认计划".to_string()),
      action: Some(A2UIAction {
        event: A2UIEvent {
          name: "retrofit_confirm".to_string(),
          data: serde_json::json!({ "sessionId": session_id }),
        },
      }),
      children: None,
      label: None,
      value: None,
      min: None,
      max: None,
      data_path: None,
      actions: None,
      tags: None,
    });
    components.push(A2UIComponent {
      id: "btn-redirect".to_string(),
      component: "Button".to_string(),
      variant: Some("secondary".to_string()),
      text: Some("改变想法".to_string()),
      action: Some(A2UIAction {
        event: A2UIEvent {
          name: "retrofit_redirect".to_string(),
          data: serde_json::json!({ "sessionId": session_id }),
        },
      }),
      children: None,
      label: None,
      value: None,
      min: None,
      max: None,
      data_path: None,
      actions: None,
      tags: None,
    });
    components.push(A2UIComponent {
      id: "btn-abort".to_string(),
      component: "Button".to_string(),
      variant: Some("danger".to_string()),
      text: Some("终止改造".to_string()),
      action: Some(A2UIAction {
        event: A2UIEvent {
          name: "retrofit_abort".to_string(),
          data: serde_json::json!({ "sessionId": session_id }),
        },
      }),
      children: None,
      label: None,
      value: None,
      min: None,
      max: None,
      data_path: None,
      actions: None,
      tags: None,
    });

    messages.push(A2UIMessage {
      version: "v0.9".to_string(),
      create_surface: None,
      update_components: Some(A2UIUpdateComponents { surface_id: surface_id.clone(), components }),
      update_data_model: None,
    });

    let mut intent_data = serde_json::Map::new();
    for (i, intent) in intents.iter().enumerate() {
      intent_data.insert(
        i.to_string(),
        serde_json::json!({ "type": intent.intent_type, "description": intent.description }),
      );
    }
    messages.push(A2UIMessage {
      version: "v0.9".to_string(),
      create_surface: None,
      update_components: None,
      update_data_model: Some(A2UIUpdateDataModel {
        surface_id,
        path: "/intents".to_string(),
        value: serde_json::Value::Object(intent_data),
      }),
    });

    messages
  }

  #[must_use]
  #[allow(clippy::too_many_lines)]
  #[allow(clippy::cast_precision_loss)]
  pub fn progress_surface(
    session_id: &str,
    applied: usize,
    total: usize,
    current_intent_type: &str,
  ) -> A2UIMessage {
    let surface_id = format!("retrofit-{session_id}");
    A2UIMessage {
      version: "v0.9".to_string(),
      create_surface: None,
      update_components: Some(A2UIUpdateComponents {
        surface_id,
        components: vec![
          A2UIComponent {
            id: "root".to_string(),
            component: "Column".to_string(),
            children: Some(vec![
              "header".to_string(),
              "progress".to_string(),
              "current".to_string(),
              "actions".to_string(),
            ]),
            text: None,
            variant: None,
            label: None,
            value: None,
            min: None,
            max: None,
            data_path: None,
            action: None,
            actions: None,
            tags: None,
          },
          A2UIComponent {
            id: "header".to_string(),
            component: "Text".to_string(),
            text: Some(format!("\u{1f527} 改造进行中 \u{2014} {session_id}")),
            variant: Some("h3".to_string()),
            children: None,
            label: None,
            value: None,
            min: None,
            max: None,
            data_path: None,
            action: None,
            actions: None,
            tags: None,
          },
          A2UIComponent {
            id: "progress".to_string(),
            component: "StatBar".to_string(),
            label: Some("进度".to_string()),
            value: Some(serde_json::json!(applied)),
            min: Some(0.0),
            max: Some(total as f64),
            children: None,
            text: None,
            variant: None,
            data_path: None,
            action: None,
            actions: None,
            tags: None,
          },
          A2UIComponent {
            id: "current".to_string(),
            component: "Text".to_string(),
            text: Some(format!("正在应用: {current_intent_type} ({applied}/{total})")),
            variant: Some("body".to_string()),
            children: None,
            label: None,
            value: None,
            min: None,
            max: None,
            data_path: None,
            action: None,
            actions: None,
            tags: None,
          },
          A2UIComponent {
            id: "actions".to_string(),
            component: "Row".to_string(),
            children: Some(vec![
              "btn-rollback".to_string(),
              "btn-redirect".to_string(),
              "btn-abort".to_string(),
            ]),
            text: None,
            variant: None,
            label: None,
            value: None,
            min: None,
            max: None,
            data_path: None,
            action: None,
            actions: None,
            tags: None,
          },
          A2UIComponent {
            id: "btn-rollback".to_string(),
            component: "Button".to_string(),
            variant: Some("secondary".to_string()),
            text: Some("回滚上一步".to_string()),
            action: Some(A2UIAction {
              event: A2UIEvent {
                name: "retrofit_rollback".to_string(),
                data: serde_json::json!({ "sessionId": session_id }),
              },
            }),
            children: None,
            label: None,
            value: None,
            min: None,
            max: None,
            data_path: None,
            actions: None,
            tags: None,
          },
          A2UIComponent {
            id: "btn-redirect".to_string(),
            component: "Button".to_string(),
            variant: Some("secondary".to_string()),
            text: Some("改变想法".to_string()),
            action: Some(A2UIAction {
              event: A2UIEvent {
                name: "retrofit_redirect".to_string(),
                data: serde_json::json!({ "sessionId": session_id }),
              },
            }),
            children: None,
            label: None,
            value: None,
            min: None,
            max: None,
            data_path: None,
            actions: None,
            tags: None,
          },
          A2UIComponent {
            id: "btn-abort".to_string(),
            component: "Button".to_string(),
            variant: Some("danger".to_string()),
            text: Some("终止改造".to_string()),
            action: Some(A2UIAction {
              event: A2UIEvent {
                name: "retrofit_abort".to_string(),
                data: serde_json::json!({ "sessionId": session_id }),
              },
            }),
            children: None,
            label: None,
            value: None,
            min: None,
            max: None,
            data_path: None,
            actions: None,
            tags: None,
          },
        ],
      }),
      update_data_model: None,
    }
  }

  #[must_use]
  #[allow(clippy::too_many_lines)]
  pub fn verify_surface(
    session_id: &str,
    applied: usize,
    rolled_back: usize,
    healthy: bool,
    issues: &[String],
  ) -> A2UIMessage {
    let surface_id = format!("retrofit-{session_id}");
    let status_icon = if healthy { "\u{2705}" } else { "\u{26a0}\u{fe0f}" };
    let status_text = if healthy { "健康检查通过" } else { "健康检查发现问题" };

    let issue_ids: Vec<String> =
      issues.iter().enumerate().map(|(i, _)| format!("issue-{i}")).collect();
    let action_children = if healthy {
      vec!["btn-accept".to_string(), "btn-repair".to_string()]
    } else {
      vec!["btn-repair".to_string(), "btn-abort".to_string()]
    };

    let mut components: Vec<A2UIComponent> = vec![
      A2UIComponent {
        id: "root".to_string(),
        component: "Column".to_string(),
        children: Some(vec![
          "header".to_string(),
          "status".to_string(),
          "stats".to_string(),
          "issues".to_string(),
          "actions".to_string(),
        ]),
        text: None,
        variant: None,
        label: None,
        value: None,
        min: None,
        max: None,
        data_path: None,
        action: None,
        actions: None,
        tags: None,
      },
      A2UIComponent {
        id: "header".to_string(),
        component: "Text".to_string(),
        text: Some(format!("\u{1f527} 改造验收 \u{2014} {session_id}")),
        variant: Some("h3".to_string()),
        children: None,
        label: None,
        value: None,
        min: None,
        max: None,
        data_path: None,
        action: None,
        actions: None,
        tags: None,
      },
      A2UIComponent {
        id: "status".to_string(),
        component: "Text".to_string(),
        text: Some(format!("{status_icon} {status_text}")),
        variant: Some("body".to_string()),
        children: None,
        label: None,
        value: None,
        min: None,
        max: None,
        data_path: None,
        action: None,
        actions: None,
        tags: None,
      },
      A2UIComponent {
        id: "stats".to_string(),
        component: "Row".to_string(),
        children: Some(vec!["stat-applied".to_string(), "stat-rolled".to_string()]),
        text: None,
        variant: None,
        label: None,
        value: None,
        min: None,
        max: None,
        data_path: None,
        action: None,
        actions: None,
        tags: None,
      },
      A2UIComponent {
        id: "stat-applied".to_string(),
        component: "Text".to_string(),
        text: Some(format!("已应用: {applied}")),
        variant: Some("body".to_string()),
        children: None,
        label: None,
        value: None,
        min: None,
        max: None,
        data_path: None,
        action: None,
        actions: None,
        tags: None,
      },
      A2UIComponent {
        id: "stat-rolled".to_string(),
        component: "Text".to_string(),
        text: Some(format!("已回滚: {rolled_back}")),
        variant: Some("body".to_string()),
        children: None,
        label: None,
        value: None,
        min: None,
        max: None,
        data_path: None,
        action: None,
        actions: None,
        tags: None,
      },
      A2UIComponent {
        id: "issues".to_string(),
        component: "Column".to_string(),
        children: Some(issue_ids),
        text: None,
        variant: None,
        label: None,
        value: None,
        min: None,
        max: None,
        data_path: None,
        action: None,
        actions: None,
        tags: None,
      },
    ];

    for (i, issue) in issues.iter().enumerate() {
      components.push(A2UIComponent {
        id: format!("issue-{i}"),
        component: "Text".to_string(),
        text: Some(format!("\u{2022} {issue}")),
        variant: Some("caption".to_string()),
        children: None,
        label: None,
        value: None,
        min: None,
        max: None,
        data_path: None,
        action: None,
        actions: None,
        tags: None,
      });
    }

    components.push(A2UIComponent {
      id: "actions".to_string(),
      component: "Row".to_string(),
      children: Some(action_children),
      text: None,
      variant: None,
      label: None,
      value: None,
      min: None,
      max: None,
      data_path: None,
      action: None,
      actions: None,
      tags: None,
    });

    if healthy {
      components.push(A2UIComponent {
        id: "btn-accept".to_string(),
        component: "Button".to_string(),
        variant: Some("primary".to_string()),
        text: Some("验收通过".to_string()),
        action: Some(A2UIAction {
          event: A2UIEvent {
            name: "retrofit_accept".to_string(),
            data: serde_json::json!({ "sessionId": session_id }),
          },
        }),
        children: None,
        label: None,
        value: None,
        min: None,
        max: None,
        data_path: None,
        actions: None,
        tags: None,
      });
    }

    components.push(A2UIComponent {
      id: "btn-repair".to_string(),
      component: "Button".to_string(),
      variant: Some("secondary".to_string()),
      text: Some("需要修复".to_string()),
      action: Some(A2UIAction {
        event: A2UIEvent {
          name: "retrofit_repair".to_string(),
          data: serde_json::json!({ "sessionId": session_id }),
        },
      }),
      children: None,
      label: None,
      value: None,
      min: None,
      max: None,
      data_path: None,
      actions: None,
      tags: None,
    });

    if !healthy {
      components.push(A2UIComponent {
        id: "btn-abort".to_string(),
        component: "Button".to_string(),
        variant: Some("danger".to_string()),
        text: Some("终止改造".to_string()),
        action: Some(A2UIAction {
          event: A2UIEvent {
            name: "retrofit_abort".to_string(),
            data: serde_json::json!({ "sessionId": session_id }),
          },
        }),
        children: None,
        label: None,
        value: None,
        min: None,
        max: None,
        data_path: None,
        actions: None,
        tags: None,
      });
    }

    A2UIMessage {
      version: "v0.9".to_string(),
      create_surface: None,
      update_components: Some(A2UIUpdateComponents { surface_id, components }),
      update_data_model: None,
    }
  }

  #[must_use]
  #[allow(clippy::too_many_lines)]
  pub fn completed_surface(
    session_id: &str,
    applied: usize,
    rolled_back: usize,
    message: &str,
  ) -> A2UIMessage {
    let surface_id = format!("retrofit-{session_id}");
    A2UIMessage {
      version: "v0.9".to_string(),
      create_surface: None,
      update_components: Some(A2UIUpdateComponents {
        surface_id,
        components: vec![
          A2UIComponent {
            id: "root".to_string(),
            component: "Column".to_string(),
            children: Some(vec!["header".to_string(), "summary".to_string(), "stats".to_string()]),
            text: None,
            variant: None,
            label: None,
            value: None,
            min: None,
            max: None,
            data_path: None,
            action: None,
            actions: None,
            tags: None,
          },
          A2UIComponent {
            id: "header".to_string(),
            component: "Text".to_string(),
            text: Some(format!("\u{2705} 改造完成 \u{2014} {session_id}")),
            variant: Some("h3".to_string()),
            children: None,
            label: None,
            value: None,
            min: None,
            max: None,
            data_path: None,
            action: None,
            actions: None,
            tags: None,
          },
          A2UIComponent {
            id: "summary".to_string(),
            component: "Text".to_string(),
            text: Some(message.to_string()),
            variant: Some("body".to_string()),
            children: None,
            label: None,
            value: None,
            min: None,
            max: None,
            data_path: None,
            action: None,
            actions: None,
            tags: None,
          },
          A2UIComponent {
            id: "stats".to_string(),
            component: "Row".to_string(),
            children: Some(vec!["stat-applied".to_string(), "stat-rolled".to_string()]),
            text: None,
            variant: None,
            label: None,
            value: None,
            min: None,
            max: None,
            data_path: None,
            action: None,
            actions: None,
            tags: None,
          },
          A2UIComponent {
            id: "stat-applied".to_string(),
            component: "Text".to_string(),
            text: Some(format!("已应用: {applied}")),
            variant: Some("body".to_string()),
            children: None,
            label: None,
            value: None,
            min: None,
            max: None,
            data_path: None,
            action: None,
            actions: None,
            tags: None,
          },
          A2UIComponent {
            id: "stat-rolled".to_string(),
            component: "Text".to_string(),
            text: Some(format!("已回滚: {rolled_back}")),
            variant: Some("body".to_string()),
            children: None,
            label: None,
            value: None,
            min: None,
            max: None,
            data_path: None,
            action: None,
            actions: None,
            tags: None,
          },
        ],
      }),
      update_data_model: None,
    }
  }

  #[must_use]
  #[allow(clippy::too_many_arguments)]
  pub fn surface_for_phase(
    session_id: &str,
    phase: SessionPhase,
    intents: &[IntentSummary],
    applied: usize,
    total: usize,
    current_intent_type: &str,
    rolled_back: usize,
    healthy: bool,
    issues: &[String],
    message: &str,
  ) -> Vec<A2UIMessage> {
    match phase {
      SessionPhase::Negotiate | SessionPhase::Repair => {
        Self::negotiate_surface(session_id, intents)
      }
      SessionPhase::Staging | SessionPhase::Applying => {
        vec![Self::progress_surface(session_id, applied, total, current_intent_type)]
      }
      SessionPhase::Verifying => {
        vec![Self::verify_surface(session_id, applied, rolled_back, healthy, issues)]
      }
      SessionPhase::Accept | SessionPhase::Completed => {
        vec![Self::completed_surface(session_id, applied, rolled_back, message)]
      }
      SessionPhase::Aborted => {
        vec![Self::verify_surface(
          session_id,
          applied,
          rolled_back,
          false,
          &["改造已终止".to_string()],
        )]
      }
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentSummary {
  pub intent_type: String,
  pub description: String,
  pub warnings: Vec<String>,
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_negotiate_surface() {
    let messages = RetrofitA2UI::negotiate_surface(
      "test-001",
      &[IntentSummary {
        intent_type: "SetTheme".to_string(),
        description: "设置暗黑主题".to_string(),
        warnings: vec!["替换全局主题".to_string()],
      }],
    );
    assert_eq!(messages.len(), 3);
    assert!(messages[0].create_surface.is_some());
    assert!(messages[1].update_components.is_some());
    assert!(messages[2].update_data_model.is_some());
  }

  #[test]
  fn test_progress_surface() {
    let msg = RetrofitA2UI::progress_surface("test-001", 2, 5, "ModifyLayout");
    assert!(msg.update_components.is_some());
    let components = &msg.update_components.as_ref().unwrap().components;
    assert!(components.iter().any(|c| c.id == "progress"));
  }

  #[test]
  fn test_verify_surface_healthy() {
    let msg = RetrofitA2UI::verify_surface("test-001", 3, 0, true, &[]);
    let components = &msg.update_components.as_ref().unwrap().components;
    assert!(components.iter().any(|c| c.id == "btn-accept"));
    assert!(!components.iter().any(|c| c.id == "btn-abort"));
  }

  #[test]
  fn test_verify_surface_unhealthy() {
    let msg = RetrofitA2UI::verify_surface("test-001", 2, 1, false, &["数据为零".to_string()]);
    let components = &msg.update_components.as_ref().unwrap().components;
    assert!(components.iter().any(|c| c.id == "btn-abort"));
    assert!(!components.iter().any(|c| c.id == "btn-accept"));
  }

  #[test]
  fn test_completed_surface() {
    let msg = RetrofitA2UI::completed_surface("test-001", 3, 0, "改造完成");
    let components = &msg.update_components.as_ref().unwrap().components;
    assert!(components
      .iter()
      .any(|c| c.id == "header" && c.text.as_ref().unwrap().contains("改造完成")));
  }

  #[test]
  fn test_surface_for_phase() {
    let messages = RetrofitA2UI::surface_for_phase(
      "test-001",
      SessionPhase::Negotiate,
      &[IntentSummary {
        intent_type: "SetTheme".to_string(),
        description: "设置主题".to_string(),
        warnings: vec![],
      }],
      0,
      1,
      "",
      0,
      true,
      &[],
      "",
    );
    assert!(!messages.is_empty());

    let msg = RetrofitA2UI::surface_for_phase(
      "test-001",
      SessionPhase::Completed,
      &[],
      3,
      3,
      "",
      0,
      true,
      &[],
      "完成",
    );
    assert!(!msg.is_empty());
  }
}
