// ─── 测试 ────────────────────────────────────────────

    use super::*;

    #[test]
    fn got_config_default_should_enable_aggregation() {
        let cfg = GoTConfig::default();
        assert!(cfg.aggregation_enabled);
        assert_eq!(cfg.aggregation_threshold, 70);
        assert_eq!(cfg.max_aggregation_size, 3);
        assert_eq!(cfg.aggregation_branch_factor, 1);
    }

    #[test]
    fn got_config_should_serialize_with_snake_case() {
        let cfg = GoTConfig::default();
        let json = serde_json::to_string(&cfg).expect("应能序列化");
        // flatten 后的 ToTConfig 字段保持 snake_case
        assert!(json.contains("\"max_depth\""));
        assert!(json.contains("\"aggregation_enabled\""));
        assert!(json.contains("\"aggregation_threshold\""));
    }

    #[test]
    fn aggregation_prompt_template_default_should_contain_placeholders() {
        let tpl = AggregationPromptTemplate::default();
        assert!(tpl.user_template.contains("{context}"));
        assert!(tpl.user_template.contains("{thoughts}"));
    }

    #[test]
    fn llm_aggregation_strategy_render_prompt_should_include_thoughts() {
        let strategy = LlmAggregationStrategy::new();
        let nodes = vec![
            ThoughtNode {
                id: "n1".into(),
                content: "思维1".into(),
                parent_id: None,
                parents: Vec::new(),
                depth: 0,
                score: Some(85),
                score_reasoning: None,
                children: vec![],
                status: ThoughtNodeStatus::Scored,
            },
            ThoughtNode {
                id: "n2".into(),
                content: "思维2".into(),
                parent_id: None,
                parents: Vec::new(),
                depth: 0,
                score: Some(90),
                score_reasoning: None,
                children: vec![],
                status: ThoughtNodeStatus::Scored,
            },
        ];
        let prompt = strategy.render_user_prompt("测试上下文", &nodes);
        assert!(prompt.contains("测试上下文"));
        assert!(prompt.contains("思维1"));
        assert!(prompt.contains("思维2"));
    }

    #[test]
    fn thought_node_with_parents_should_serialize() {
        let node = ThoughtNode {
            id: "agg_1".into(),
            content: "聚合思维".into(),
            parent_id: Some("n1".into()),
            parents: vec!["n1".into(), "n2".into(), "n3".into()],
            depth: 1,
            score: Some(95),
            score_reasoning: Some("综合了三个源思维".into()),
            children: vec![],
            status: ThoughtNodeStatus::Scored,
        };
        let json = serde_json::to_string(&node).expect("应能序列化");
        assert!(json.contains("\"parents\""));
        assert!(json.contains("\"n1\""));
        assert!(json.contains("\"n3\""));
    }

    #[test]
    fn thought_node_without_parents_should_back_compat_deserialize() {
        // 老数据（无 parents 字段）应能反序列化（默认空 Vec）
        let old_json = r#"{
            "id": "n1",
            "content": "a",
            "parent_id": null,
            "depth": 0,
            "score": 80,
            "children": [],
            "status": "scored"
        }"#;
        let node: ThoughtNode = serde_json::from_str(old_json).expect("应能反序列化老数据");
        assert!(node.parents.is_empty());
    }
