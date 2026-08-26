//! A2UI（Agent-to-UI）数据结构，详细见 docs/details/注释/agent-runtime/a2ui.md

use serde::{Deserialize, Serialize};

// ─── 组件层 ────────────────────────────────────────────

/// A2UI 组件定义（对应 TS `A2UIComponent`），详细见 docs/details/注释/agent-runtime/a2ui.md
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

/// 组件动作（对应 TS `A2UIAction`）
///
/// 包装一个 `A2UIEvent`，当用户点击组件时触发。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2UIAction {
    pub event: A2UIEvent,
}

/// 事件定义（对应 TS `A2UIEvent`）
///
/// # 字段
/// - `name`：事件名（如 "retrofit_confirm"、"edit"、"delete"）
/// - `data`：事件数据（任意 JSON，由前端处理）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2UIEvent {
    pub name: String,
    pub data: serde_json::Value,
}

/// 列表项动作（对应 TS `A2UIItemAction`）
///
/// 用于 EntityCard 等组件的多个操作按钮。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2UIItemAction {
    pub name: String,
    pub label: String,
    pub variant: String,
}

// ─── 消息层 ────────────────────────────────────────────

/// A2UI 消息（对应 TS `A2UIMessage` 联合类型），详细见 docs/details/注释/agent-runtime/a2ui.md
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2UIMessage {
    /// 协议版本（当前为 "v0.9"）
    pub version: String,
    /// 创建画布（对应 TS `createSurface` 变体）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub create_surface: Option<A2UICreateSurface>,
    /// 更新组件树（对应 TS `updateComponents` 变体）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_components: Option<A2UIUpdateComponents>,
    /// 更新数据模型（对应 TS `updateDataModel` 变体）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_data_model: Option<A2UIUpdateDataModel>,
    /// 删除画布（对应 TS `deleteSurface` 变体）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delete_surface: Option<A2UIDeleteSurface>,
}

/// 创建画布指令（对应 TS `createSurface`）
///
/// # 字段
/// - `surface_id`：画布唯一标识（如 "entity-card-1"、"retrofit-xxx"）
/// - `catalog_id`：组件目录 ID（默认 "https://worldsmith.app/catalog/v1"）
/// - `theme`：主题配置（可选，前端按目录默认主题渲染）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2UICreateSurface {
    pub surface_id: String,
    pub catalog_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<serde_json::Value>,
}

/// 更新组件树指令（对应 TS `updateComponents`）
///
/// # 字段
/// - `surface_id`：目标画布 ID
/// - `components`：组件列表（完整替换画布上的组件树）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2UIUpdateComponents {
    pub surface_id: String,
    pub components: Vec<A2UIComponent>,
}

/// 更新数据模型指令（对应 TS `updateDataModel`）
///
/// # 字段
/// - `surface_id`：目标画布 ID
/// - `path`：数据路径（如 "/entity"、"intents"、"/stats"）
/// - `value`：要设置的数据值（任意 JSON）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2UIUpdateDataModel {
    pub surface_id: String,
    pub path: String,
    pub value: serde_json::Value,
}

/// 删除画布指令（对应 TS `deleteSurface`）
///
/// # 字段
/// - `surface_id`：要删除的画布 ID
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2UIDeleteSurface {
    pub surface_id: String,
}

// ─── 构造辅助 ────────────────────────────────────────────

impl A2UIMessage {
    /// 创建 `createSurface` 变体消息
    #[must_use]
    pub fn create_surface(surface_id: impl Into<String>, catalog_id: impl Into<String>) -> Self {
        Self {
            version: "v0.9".to_string(),
            create_surface: Some(A2UICreateSurface {
                surface_id: surface_id.into(),
                catalog_id: catalog_id.into(),
                theme: None,
            }),
            update_components: None,
            update_data_model: None,
            delete_surface: None,
        }
    }

    /// 创建 `updateComponents` 变体消息
    #[must_use]
    pub fn update_components(
        surface_id: impl Into<String>,
        components: Vec<A2UIComponent>,
    ) -> Self {
        Self {
            version: "v0.9".to_string(),
            create_surface: None,
            update_components: Some(A2UIUpdateComponents {
                surface_id: surface_id.into(),
                components,
            }),
            update_data_model: None,
            delete_surface: None,
        }
    }

    /// 创建 `updateDataModel` 变体消息
    #[must_use]
    pub fn update_data_model(
        surface_id: impl Into<String>,
        path: impl Into<String>,
        value: serde_json::Value,
    ) -> Self {
        Self {
            version: "v0.9".to_string(),
            create_surface: None,
            update_components: None,
            update_data_model: Some(A2UIUpdateDataModel {
                surface_id: surface_id.into(),
                path: path.into(),
                value,
            }),
            delete_surface: None,
        }
    }

    /// 创建 `deleteSurface` 变体消息
    #[must_use]
    pub fn delete_surface(surface_id: impl Into<String>) -> Self {
        Self {
            version: "v0.9".to_string(),
            create_surface: None,
            update_components: None,
            update_data_model: None,
            delete_surface: Some(A2UIDeleteSurface {
                surface_id: surface_id.into(),
            }),
        }
    }
}

impl A2UIComponent {
    /// 快速构造一个简单组件（仅 id + component + 可选 text）
    #[must_use]
    pub fn new(id: impl Into<String>, component: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            component: component.into(),
            children: None,
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
        }
    }

    /// 链式设置 text
    #[must_use]
    pub fn with_text(mut self, text: impl Into<String>) -> Self {
        self.text = Some(text.into());
        self
    }

    /// 链式设置 variant
    #[must_use]
    pub fn with_variant(mut self, variant: impl Into<String>) -> Self {
        self.variant = Some(variant.into());
        self
    }

    /// 链式设置 children
    #[must_use]
    pub fn with_children(mut self, children: Vec<String>) -> Self {
        self.children = Some(children);
        self
    }

    /// 链式设置 data_path
    #[must_use]
    pub fn with_data_path(mut self, path: impl Into<String>) -> Self {
        self.data_path = Some(path.into());
        self
    }

    /// 链式设置 action
    #[must_use]
    pub fn with_action(mut self, event_name: impl Into<String>, data: serde_json::Value) -> Self {
        self.action = Some(A2UIAction {
            event: A2UIEvent {
                name: event_name.into(),
                data,
            },
        });
        self
    }
}

// ─── 测试 ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_surface_message_should_serialize_camel_case() {
        let msg = A2UIMessage::create_surface("test-1", "https://example.com/catalog");
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"version\":\"v0.9\""));
        assert!(json.contains("\"createSurface\":{"));
        assert!(json.contains("\"surfaceId\":\"test-1\""));
        assert!(json.contains("\"catalogId\":\"https://example.com/catalog\""));
        // 其他变体字段不应出现
        assert!(!json.contains("\"updateComponents\""));
        assert!(!json.contains("\"deleteSurface\""));
    }

    #[test]
    fn update_components_message_should_serialize_camel_case() {
        let msg = A2UIMessage::update_components(
            "test-1",
            vec![A2UIComponent::new("root", "Column")
                .with_children(vec!["header".to_string()])
                .with_text("hello")
                .with_variant("h3")],
        );
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"updateComponents\":{"));
        assert!(json.contains("\"surfaceId\":\"test-1\""));
        assert!(json.contains("\"component\":\"Column\""));
        assert!(json.contains("\"children\":[\"header\"]"));
        assert!(json.contains("\"text\":\"hello\""));
        assert!(json.contains("\"variant\":\"h3\""));
    }

    #[test]
    fn update_data_model_message_should_serialize_camel_case() {
        let msg = A2UIMessage::update_data_model(
            "test-1",
            "/entity",
            serde_json::json!({ "name": "Alice", "age": 30 }),
        );
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"updateDataModel\":{"));
        assert!(json.contains("\"path\":\"/entity\""));
        assert!(json.contains("\"name\":\"Alice\""));
    }

    #[test]
    fn delete_surface_message_should_serialize_camel_case() {
        let msg = A2UIMessage::delete_surface("test-1");
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"deleteSurface\":{"));
        assert!(json.contains("\"surfaceId\":\"test-1\""));
        assert!(!json.contains("\"createSurface\""));
        assert!(!json.contains("\"updateComponents\""));
    }

    #[test]
    fn component_with_action_should_serialize_event() {
        let comp = A2UIComponent::new("btn", "Button")
            .with_action("confirm", serde_json::json!({ "id": "123" }));
        let json = serde_json::to_string(&comp).unwrap();
        assert!(json.contains("\"action\":{"));
        assert!(json.contains("\"event\":{"));
        assert!(json.contains("\"name\":\"confirm\""));
        assert!(json.contains("\"data\":{\"id\":\"123\"}"));
    }

    #[test]
    fn message_should_be_backward_compatible_with_worldsmith_core() {
        // 确保字段命名与 worldsmith-core/src/retrofit/a2ui.rs 一致
        // （worldsmith-core 缺少 delete_surface，但其他字段名相同）
        let msg = A2UIMessage {
            version: "v0.9".to_string(),
            create_surface: Some(A2UICreateSurface {
                surface_id: "s1".into(),
                catalog_id: "c1".into(),
                theme: None,
            }),
            update_components: None,
            update_data_model: None,
            delete_surface: None,
        };
        let json = serde_json::to_string(&msg).unwrap();
        // 与 worldsmith-core 序列化结果对比
        assert!(json.contains("\"surfaceId\":\"s1\""));
        assert!(json.contains("\"catalogId\":\"c1\""));
    }
}
