// ─── 单元测试 ────────────────────────────────────────────

    use super::*;

    #[test]
    fn test_agent_role_as_str() {
        assert_eq!(AgentRole::Coordinator.as_str(), "coordinator");
        assert_eq!(AgentRole::Worker.as_str(), "worker");
        assert_eq!(AgentRole::Critic.as_str(), "critic");
        assert_eq!(AgentRole::Researcher.as_str(), "researcher");
        assert_eq!(AgentRole::Creative.as_str(), "creative");
        assert_eq!(AgentRole::Custom.as_str(), "custom");
    }

    #[test]
    fn test_agent_message_helpers() {
        let msg = AgentMessage::Task {
            from: "a".into(),
            to: "b".into(),
            content: "hello".into(),
        };
        assert_eq!(msg.from(), "a");
        assert_eq!(msg.to(), "b");
        assert_eq!(msg.content(), "hello");
        assert_eq!(msg.message_type(), "task");

        let broadcast = AgentMessage::Broadcast {
            from: "a".into(),
            content: "info".into(),
        };
        assert_eq!(broadcast.to(), "all");
        assert_eq!(broadcast.message_type(), "broadcast");
    }

    #[test]
    fn test_shared_blackboard() {
        let mut bb = SharedBlackboard::new("测试任务");
        assert_eq!(bb.task, "测试任务");
        assert_eq!(bb.rounds_completed, 0);

        bb.set("key1", "value1");
        assert_eq!(bb.get("key1"), Some(&"value1".to_string()));

        bb.append_output("agent_a", "输出1");
        bb.append_output("agent_a", "输出2");
        assert_eq!(bb.get_outputs("agent_a"), &["输出1", "输出2"]);

        bb.set_final_result("最终结果");
        assert_eq!(bb.final_result, Some("最终结果".to_string()));

        bb.increment_rounds();
        assert_eq!(bb.rounds_completed, 1);
    }

    #[test]
    fn test_topology_mesh_build_network() {
        let agent_ids = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let mut senders = HashMap::new();
        for id in &agent_ids {
            let (tx, _rx) = mpsc::channel::<AgentMessage>(8);
            senders.insert(id.clone(), tx);
        }

        let network = Topology::Mesh.build_sender_network(&agent_ids, &senders);
        assert_eq!(network.len(), 3);
        // Mesh: 每个 Agent 应有 2 个 peers
        assert_eq!(network.get("a").unwrap().len(), 2);
        assert_eq!(network.get("b").unwrap().len(), 2);
        assert_eq!(network.get("c").unwrap().len(), 2);
    }

    #[test]
    fn test_topology_ring_build_network() {
        let agent_ids = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let mut senders = HashMap::new();
        for id in &agent_ids {
            let (tx, _rx) = mpsc::channel::<AgentMessage>(8);
            senders.insert(id.clone(), tx);
        }

        let network = Topology::Ring.build_sender_network(&agent_ids, &senders);
        // Ring: 每个 Agent 只能向下一个发消息
        assert_eq!(network.get("a").unwrap().len(), 1);
        assert!(network.get("a").unwrap().contains_key("b"));
        assert_eq!(network.get("b").unwrap().len(), 1);
        assert!(network.get("b").unwrap().contains_key("c"));
        assert_eq!(network.get("c").unwrap().len(), 1);
        assert!(network.get("c").unwrap().contains_key("a"));
    }

    #[test]
    fn test_topology_star_build_network() {
        let agent_ids = vec![
            "hub".to_string(),
            "a".to_string(),
            "b".to_string(),
        ];
        let mut senders = HashMap::new();
        for id in &agent_ids {
            let (tx, _rx) = mpsc::channel::<AgentMessage>(8);
            senders.insert(id.clone(), tx);
        }

        let network = Topology::Star {
            hub_id: "hub".into(),
        }
        .build_sender_network(&agent_ids, &senders);

        // 中心 Agent 可向所有其他 Agent 发消息
        assert_eq!(network.get("hub").unwrap().len(), 2);
        // 非中心 Agent 只能向中心发消息
        assert_eq!(network.get("a").unwrap().len(), 1);
        assert!(network.get("a").unwrap().contains_key("hub"));
        assert_eq!(network.get("b").unwrap().len(), 1);
        assert!(network.get("b").unwrap().contains_key("hub"));
    }

    #[test]
    fn test_topology_pipeline_build_network() {
        let agent_ids = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let mut senders = HashMap::new();
        for id in &agent_ids {
            let (tx, _rx) = mpsc::channel::<AgentMessage>(8);
            senders.insert(id.clone(), tx);
        }

        let network = Topology::Pipeline.build_sender_network(&agent_ids, &senders);
        // Pipeline: A→B→C，单向
        assert_eq!(network.get("a").unwrap().len(), 1);
        assert!(network.get("a").unwrap().contains_key("b"));
        assert_eq!(network.get("b").unwrap().len(), 1);
        assert!(network.get("b").unwrap().contains_key("c"));
        // 末端 C 无下游
        assert_eq!(network.get("c").unwrap().len(), 0);
    }

    #[test]
    fn test_topology_custom_build_network() {
        let agent_ids = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let mut senders = HashMap::new();
        for id in &agent_ids {
            let (tx, _rx) = mpsc::channel::<AgentMessage>(8);
            senders.insert(id.clone(), tx);
        }

        let mut peers = HashMap::new();
        peers.insert("a".to_string(), vec!["b".to_string(), "c".to_string()]);
        peers.insert("b".to_string(), vec!["c".to_string()]);
        peers.insert("c".to_string(), vec!["a".to_string()]);

        let network = Topology::Custom { peers }.build_sender_network(&agent_ids, &senders);
        assert_eq!(network.get("a").unwrap().len(), 2);
        assert_eq!(network.get("b").unwrap().len(), 1);
        assert_eq!(network.get("c").unwrap().len(), 1);
    }

    #[test]
    fn test_multi_agent_config_default() {
        let config = MultiAgentConfig::default();
        assert_eq!(config.max_rounds, 10);
        assert_eq!(config.max_concurrency, 5);
        assert!(matches!(config.topology, Topology::Mesh));
        assert!(config.blackboard_enabled);
        assert!(config.message_passing_enabled);
        assert_eq!(config.channel_capacity, 32);
        assert!(config.require_synthesis);
    }

    #[test]
    fn test_collecting_emitter() {
        let emitter = CollectingEmitter::new();
        emitter.emit_safe(OrchestratorEvent::MultiAgentRoundStarted {
            node_id: "test".into(),
            round: 1,
            agent_count: 3,
        });

        let rt = tokio::runtime::Runtime::new().unwrap();
        let collected = rt.block_on(emitter.drain());
        assert_eq!(collected.len(), 1);
    }
