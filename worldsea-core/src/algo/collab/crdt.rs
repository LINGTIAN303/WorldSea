use std::collections::{BTreeMap, HashMap, HashSet};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorClock {
  pub counter: u64,
  pub node_id: String,
}

impl VectorClock {
  #[must_use]
  pub fn new(node_id: String) -> Self {
    Self { counter: 0, node_id }
  }

  pub fn tick(&mut self) -> u64 {
    self.counter += 1;
    self.counter
  }

  #[must_use]
  pub fn happens_before(&self, other: &VectorClock) -> bool {
    self.counter < other.counter
  }

  #[must_use]
  pub fn is_concurrent(&self, other: &VectorClock) -> bool {
    !self.happens_before(other) && !other.happens_before(self) && self.node_id != other.node_id
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LWWRegister<T: Clone> {
  pub value: T,
  pub timestamp: u64,
  pub node_id: String,
}

impl<T: Clone> LWWRegister<T> {
  #[must_use]
  pub fn new(value: T, node_id: String) -> Self {
    Self {
      value,
      timestamp: 0,
      node_id,
    }
  }

  pub fn set(&mut self, value: T, timestamp: u64) {
    if timestamp >= self.timestamp {
      self.value = value;
      self.timestamp = timestamp;
    }
  }

  pub fn merge(&mut self, other: &LWWRegister<T>) {
    if other.timestamp > self.timestamp
      || (other.timestamp == self.timestamp && other.node_id > self.node_id)
    {
      self.value = other.value.clone();
      self.timestamp = other.timestamp;
      self.node_id = other.node_id.clone();
    }
  }

  #[must_use]
  pub fn get(&self) -> &T {
    &self.value
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ORSet<T: Clone + Eq + std::hash::Hash> {
  pub added: HashMap<T, u64>,
  pub removed: HashSet<T>,
  pub node_id: String,
  pub counter: u64,
}

impl<T: Clone + Eq + std::hash::Hash> ORSet<T> {
  #[must_use]
  pub fn new(node_id: String) -> Self {
    Self {
      added: HashMap::new(),
      removed: HashSet::new(),
      node_id,
      counter: 0,
    }
  }

  pub fn add(&mut self, element: T) {
    self.counter += 1;
    self.added.entry(element).and_modify(|t| *t = (*t).max(self.counter)).or_insert(self.counter);
  }

  pub fn remove(&mut self, element: &T) {
    if self.added.contains_key(element) {
      self.removed.insert(element.clone());
    }
  }

  #[must_use]
  pub fn contains(&self, element: &T) -> bool {
    self.added.contains_key(element) && !self.removed.contains(element)
  }

  #[must_use]
  pub fn elements(&self) -> Vec<&T> {
    self
      .added
      .keys()
      .filter(|e| !self.removed.contains(*e))
      .collect()
  }

  pub fn merge(&mut self, other: &ORSet<T>) {
    for (element, timestamp) in &other.added {
      let should_add = match self.added.get(element) {
        Some(self_ts) => timestamp > self_ts,
        None => true,
      };
      if should_add {
        self.added.insert(element.clone(), *timestamp);
      }
    }
    for element in &other.removed {
      if self.added.contains_key(element) {
        self.removed.insert(element.clone());
      }
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RGANode {
  pub id: String,
  pub left_id: Option<String>,
  pub right_id: Option<String>,
  pub content: String,
  pub deleted: bool,
  pub timestamp: u64,
  pub node_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RGA {
  pub nodes: BTreeMap<String, RGANode>,
  pub node_id: String,
  pub counter: u64,
}

impl RGA {
  #[must_use]
  pub fn new(node_id: String) -> Self {
    Self {
      nodes: BTreeMap::new(),
      node_id,
      counter: 0,
    }
  }

  pub fn insert(&mut self, index: usize, content: String) -> String {
    self.counter += 1;
    let id = format!("{}:{}", self.node_id, self.counter);

    let ordered: Vec<&RGANode> = self
      .nodes
      .values()
      .filter(|n| !n.deleted)
      .collect();

    let left_id = if index == 0 || ordered.is_empty() {
      None
    } else {
      let idx = (index - 1).min(ordered.len() - 1);
      Some(ordered[idx].id.clone())
    };

    let right_id = if index < ordered.len() {
      Some(ordered[index].id.clone())
    } else {
      None
    };

    let node = RGANode {
      id: id.clone(),
      left_id,
      right_id,
      content,
      deleted: false,
      timestamp: self.counter,
      node_id: self.node_id.clone(),
    };

    self.nodes.insert(id.clone(), node);
    id
  }

  pub fn delete(&mut self, id: &str) -> bool {
    if let Some(node) = self.nodes.get_mut(id) {
      node.deleted = true;
      return true;
    }
    false
  }

  #[must_use]
  pub fn text(&self) -> String {
    self
      .nodes
      .values()
      .filter(|n| !n.deleted)
      .map(|n| n.content.as_str())
      .collect()
  }

  pub fn merge(&mut self, other: &RGA) {
    for (id, node) in &other.nodes {
      match self.nodes.get(id) {
        Some(existing) => {
          if node.timestamp > existing.timestamp {
            self.nodes.insert(id.clone(), node.clone());
          }
        }
        None => {
          self.nodes.insert(id.clone(), node.clone());
        }
      }
    }
  }

  #[must_use]
  pub fn length(&self) -> usize {
    self.nodes.values().filter(|n| !n.deleted).count()
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_lww_register_new() {
    let reg = LWWRegister::new("hello".to_string(), "node1".to_string());
    assert_eq!(reg.get(), &"hello".to_string());
  }

  #[test]
  fn test_lww_register_set_newer() {
    let mut reg = LWWRegister::new("hello".to_string(), "node1".to_string());
    reg.set("world".to_string(), 2);
    assert_eq!(reg.get(), &"world".to_string());
  }

  #[test]
  fn test_lww_register_set_older_ignored() {
    let mut reg = LWWRegister::new("hello".to_string(), "node1".to_string());
    reg.timestamp = 5;
    reg.set("world".to_string(), 3);
    assert_eq!(reg.get(), &"hello".to_string());
  }

  #[test]
  fn test_lww_register_merge_newer_wins() {
    let mut reg1 = LWWRegister::new("a".to_string(), "node1".to_string());
    reg1.timestamp = 1;
    let mut reg2 = LWWRegister::new("b".to_string(), "node2".to_string());
    reg2.timestamp = 2;
    reg1.merge(&reg2);
    assert_eq!(reg1.get(), &"b".to_string());
  }

  #[test]
  fn test_lww_register_merge_tiebreak_node_id() {
    let mut reg1 = LWWRegister::new("a".to_string(), "node1".to_string());
    reg1.timestamp = 5;
    let mut reg2 = LWWRegister::new("b".to_string(), "node2".to_string());
    reg2.timestamp = 5;
    reg1.merge(&reg2);
    assert_eq!(reg1.get(), &"b".to_string());
  }

  #[test]
  fn test_or_set_add_contains() {
    let mut set: ORSet<String> = ORSet::new("node1".to_string());
    set.add("item1".to_string());
    assert!(set.contains(&"item1".to_string()));
    assert!(!set.contains(&"item2".to_string()));
  }

  #[test]
  fn test_or_set_remove() {
    let mut set: ORSet<String> = ORSet::new("node1".to_string());
    set.add("item1".to_string());
    set.remove(&"item1".to_string());
    assert!(!set.contains(&"item1".to_string()));
  }

  #[test]
  fn test_or_set_merge() {
    let mut set1: ORSet<String> = ORSet::new("node1".to_string());
    set1.add("a".to_string());
    set1.add("b".to_string());

    let mut set2: ORSet<String> = ORSet::new("node2".to_string());
    set2.add("b".to_string());
    set2.add("c".to_string());

    set1.merge(&set2);
    assert!(set1.contains(&"a".to_string()));
    assert!(set1.contains(&"b".to_string()));
    assert!(set1.contains(&"c".to_string()));
  }

  #[test]
  fn test_or_set_merge_with_remove() {
    let mut set1: ORSet<String> = ORSet::new("node1".to_string());
    set1.add("a".to_string());

    let mut set2: ORSet<String> = ORSet::new("node2".to_string());
    set2.add("a".to_string());
    set2.remove(&"a".to_string());

    set1.merge(&set2);
    assert!(!set1.contains(&"a".to_string()));
  }

  #[test]
  fn test_rga_insert_and_text() {
    let mut rga = RGA::new("node1".to_string());
    rga.insert(0, "H".to_string());
    rga.insert(1, "i".to_string());
    assert_eq!(rga.text(), "Hi");
  }

  #[test]
  fn test_rga_delete() {
    let mut rga = RGA::new("node1".to_string());
    rga.insert(0, "H".to_string());
    let id = rga.insert(1, "x".to_string());
    rga.insert(2, "i".to_string());
    rga.delete(&id);
    assert_eq!(rga.text(), "Hi");
  }

  #[test]
  fn test_rga_merge() {
    let mut rga1 = RGA::new("node1".to_string());
    rga1.insert(0, "A".to_string());

    let mut rga2 = RGA::new("node2".to_string());
    rga2.insert(0, "B".to_string());

    rga1.merge(&rga2);
    assert!(rga1.length() >= 2);
  }

  #[test]
  fn test_vector_clock_ordering() {
    let mut vc1 = VectorClock::new("node1".to_string());
    let mut vc2 = VectorClock::new("node2".to_string());
    vc1.tick();
    vc2.tick();
    vc2.tick();
    assert!(vc1.happens_before(&vc2));
  }

  #[test]
  fn test_vector_clock_concurrent() {
    let mut vc1 = VectorClock::new("node1".to_string());
    let mut vc2 = VectorClock::new("node2".to_string());
    vc1.tick();
    vc2.tick();
    assert!(vc1.is_concurrent(&vc2));
  }
}
