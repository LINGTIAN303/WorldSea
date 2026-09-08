use std::io::Cursor;
use serde::{Deserialize, Serialize};

use crate::algo::geometry::line::Point2D;
use crate::algo::draft::constraint::{ConstraintSystem, Constraint, ConstraintType};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DxfEntity {
  pub entity_type: String,
  pub layer: String,
  pub data: DxfEntityData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DxfEntityData {
  Line { start: Point2D, end: Point2D },
  Circle { center: Point2D, radius: f64 },
  Arc { center: Point2D, radius: f64, start_angle_deg: f64, end_angle_deg: f64 },
  LwPolyline { vertices: Vec<Point2D>, closed: bool },
  Ellipse { center: Point2D, major_axis_x: f64, major_axis_y: f64, ratio: f64, start_param: f64, end_param: f64 },
  Spline { control_points: Vec<Point2D>, degree: u32 },
  Text { location: Point2D, value: String, height: f64 },
  Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DxfImportResult {
  pub entities: Vec<DxfEntity>,
  pub constraint_system: ConstraintSystem,
  pub layer_names: Vec<String>,
  pub warnings: Vec<String>,
}

pub fn parse_dxf(content: &str) -> Result<DxfImportResult, String> {
  let mut cursor = Cursor::new(content.as_bytes());
  let drawing = dxf::Drawing::load(&mut cursor).map_err(|e| format!("DXF 解析失败: {e}"))?;
  let mut entities = Vec::new();
  let mut constraint_system = ConstraintSystem::new();
  let mut layer_names = Vec::new();
  let mut warnings = Vec::new();
  let mut point_counter: usize = 0;
  let mut line_counter: usize = 0;

  for layer in drawing.layers() {
    let name = layer.name.clone();
    if !name.is_empty() && !layer_names.contains(&name) {
      layer_names.push(name);
    }
  }

  for entity in drawing.entities() {
    let layer = entity.common.layer.clone();
    let data = match &entity.specific {
      dxf::entities::EntityType::Line(line) => {
        let start = Point2D::new(line.p1.x, line.p1.y);
        let end = Point2D::new(line.p2.x, line.p2.y);
        point_counter += 1;
        let start_id = format!("dxf_pt_{point_counter}");
        constraint_system.add_point(start_id.clone(), start, false);
        point_counter += 1;
        let end_id = format!("dxf_pt_{point_counter}");
        constraint_system.add_point(end_id.clone(), end, true);
        line_counter += 1;
        let line_id = format!("dxf_ln_{line_counter}");
        constraint_system.add_line(line_id, start_id, end_id);
        DxfEntityData::Line { start, end }
      }
      dxf::entities::EntityType::Circle(circle) => {
        DxfEntityData::Circle {
          center: Point2D::new(circle.center.x, circle.center.y),
          radius: circle.radius,
        }
      }
      dxf::entities::EntityType::Arc(arc) => {
        DxfEntityData::Arc {
          center: Point2D::new(arc.center.x, arc.center.y),
          radius: arc.radius,
          start_angle_deg: arc.start_angle.to_degrees(),
          end_angle_deg: arc.end_angle.to_degrees(),
        }
      }
      dxf::entities::EntityType::LwPolyline(lwp) => {
        let vertices: Vec<Point2D> = lwp.vertices.iter()
          .map(|v| Point2D::new(v.x, v.y))
          .collect();
        let closed = lwp.flags & 1 != 0;
        if vertices.len() >= 2 {
          for (i, vertex) in vertices.iter().enumerate() {
            point_counter += 1;
            let sid = format!("dxf_pt_{point_counter}");
            let free = i > 0;
            constraint_system.add_point(sid.clone(), *vertex, free);
            if i > 0 {
              line_counter += 1;
              let lid = format!("dxf_ln_{line_counter}");
              let prev_id = format!("dxf_pt_{}", point_counter - 1);
              constraint_system.add_line(lid, prev_id, sid);
            }
          }
          if closed && vertices.len() >= 3 {
            line_counter += 1;
            let lid = format!("dxf_ln_{line_counter}");
            let first_id = format!("dxf_pt_{}", point_counter - vertices.len() + 1);
            let last_id = format!("dxf_pt_{point_counter}");
            constraint_system.add_line(lid, last_id, first_id);
          }
        }
        DxfEntityData::LwPolyline { vertices, closed }
      }
      dxf::entities::EntityType::Ellipse(ell) => {
        DxfEntityData::Ellipse {
          center: Point2D::new(ell.center.x, ell.center.y),
          major_axis_x: ell.major_axis.x,
          major_axis_y: ell.major_axis.y,
          ratio: ell.minor_axis_ratio,
          start_param: ell.start_parameter,
          end_param: ell.end_parameter,
        }
      }
      dxf::entities::EntityType::Spline(spline) => {
        let control_points: Vec<Point2D> = spline.control_points.iter()
          .map(|p| Point2D::new(p.x, p.y))
          .collect();
        DxfEntityData::Spline {
          control_points,
          degree: spline.degree_of_curve as u32,
        }
      }
      dxf::entities::EntityType::Text(txt) => {
        DxfEntityData::Text {
          location: Point2D::new(txt.location.x, txt.location.y),
          value: txt.value.clone(),
          height: txt.text_height,
        }
      }
      _ => {
        let type_name = format!("{:?}", entity.specific);
        warnings.push(format!("跳过不支持的实体类型: {type_name}"));
        DxfEntityData::Unknown
      }
    };

    entities.push(DxfEntity {
      entity_type: format!("{:?}", entity.specific).split('(').next().unwrap_or("Unknown").to_string(),
      layer,
      data,
    });
  }

  Ok(DxfImportResult {
    entities,
    constraint_system,
    layer_names,
    warnings,
  })
}

pub fn generate_dxf(entities: &[DxfEntity]) -> Result<String, String> {
  let mut drawing = dxf::Drawing::new();

  for entity in entities {
    let dxf_entity = match &entity.data {
      DxfEntityData::Line { start, end } => {
        dxf::entities::Entity::new(dxf::entities::EntityType::Line(dxf::entities::Line {
          p1: dxf::Point::new(start.x, start.y, 0.0),
          p2: dxf::Point::new(end.x, end.y, 0.0),
          ..Default::default()
        }))
      }
      DxfEntityData::Circle { center, radius } => {
        dxf::entities::Entity::new(dxf::entities::EntityType::Circle(dxf::entities::Circle {
          center: dxf::Point::new(center.x, center.y, 0.0),
          radius: *radius,
          ..Default::default()
        }))
      }
      DxfEntityData::Arc { center, radius, start_angle_deg, end_angle_deg } => {
        dxf::entities::Entity::new(dxf::entities::EntityType::Arc(dxf::entities::Arc {
          center: dxf::Point::new(center.x, center.y, 0.0),
          radius: *radius,
          start_angle: start_angle_deg.to_radians(),
          end_angle: end_angle_deg.to_radians(),
          ..Default::default()
        }))
      }
      DxfEntityData::LwPolyline { vertices, closed } => {
        let mut lwp = dxf::entities::LwPolyline::default();
        if *closed {
          lwp.flags |= 1;
        }
        for v in vertices {
          lwp.vertices.push(dxf::LwPolylineVertex {
            x: v.x,
            y: v.y,
            ..Default::default()
          });
        }
        dxf::entities::Entity::new(dxf::entities::EntityType::LwPolyline(lwp))
      }
      DxfEntityData::Text { location, value, height } => {
        dxf::entities::Entity::new(dxf::entities::EntityType::Text(dxf::entities::Text {
          location: dxf::Point::new(location.x, location.y, 0.0),
          value: value.clone(),
          text_height: *height,
          ..Default::default()
        }))
      }
      _ => continue,
    };

    drawing.add_entity(dxf_entity);
  }

  let mut output = Vec::new();
  drawing.save(&mut output).map_err(|e| format!("DXF 生成失败: {e}"))?;
  String::from_utf8(output).map_err(|e| format!("DXF UTF-8 转换失败: {e}"))
}

pub fn extract_horizontal_vertical_constraints(system: &ConstraintSystem) -> Vec<Constraint> {
  let mut constraints = Vec::new();
  let mut counter: usize = 0;

  for line in system.lines.values() {
    let start = match system.points.get(&line.start_id) {
      Some(p) => p,
      None => continue,
    };
    let end = match system.points.get(&line.end_id) {
      Some(p) => p,
      None => continue,
    };
    let dx = (end.position.x - start.position.x).abs();
    let dy = (end.position.y - start.position.y).abs();
    let len = dx.hypot(dy);
    if len < 1e-6 { continue; }

    let tolerance = len * 0.01;
    if dy < tolerance {
      counter += 1;
      constraints.push(Constraint {
        id: format!("auto_h_{counter}"),
        constraint_type: ConstraintType::Horizontal { line_id: line.id.clone() },
        priority: 1,
      });
    } else if dx < tolerance {
      counter += 1;
      constraints.push(Constraint {
        id: format!("auto_v_{counter}"),
        constraint_type: ConstraintType::Vertical { line_id: line.id.clone() },
        priority: 1,
      });
    }
  }

  constraints
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_generate_and_parse_line() {
    let entities = vec![DxfEntity {
      entity_type: "Line".to_string(),
      layer: "0".to_string(),
      data: DxfEntityData::Line {
        start: Point2D::new(0.0, 0.0),
        end: Point2D::new(10.0, 10.0),
      },
    }];
    let dxf_content = generate_dxf(&entities).unwrap();
    let result = parse_dxf(&dxf_content).unwrap();
    assert!(!result.entities.is_empty());
    let found_line = result.entities.iter().any(|e| matches!(e.data, DxfEntityData::Line { .. }));
    assert!(found_line, "should find at least one line entity");
  }

  #[test]
  fn test_generate_and_parse_circle() {
    let entities = vec![DxfEntity {
      entity_type: "Circle".to_string(),
      layer: "0".to_string(),
      data: DxfEntityData::Circle {
        center: Point2D::new(5.0, 5.0),
        radius: 3.0,
      },
    }];
    let dxf_content = generate_dxf(&entities).unwrap();
    let result = parse_dxf(&dxf_content).unwrap();
    let found_circle = result.entities.iter().any(|e| matches!(e.data, DxfEntityData::Circle { .. }));
    assert!(found_circle, "should find at least one circle entity");
  }

  #[test]
  fn test_extract_horizontal_constraint() {
    let mut sys = ConstraintSystem::new();
    sys.add_point("p1".to_string(), Point2D::new(0.0, 0.0), false);
    sys.add_point("p2".to_string(), Point2D::new(10.0, 0.0), true);
    sys.add_line("l1".to_string(), "p1".to_string(), "p2".to_string());
    let constraints = extract_horizontal_vertical_constraints(&sys);
    assert_eq!(constraints.len(), 1);
    assert!(matches!(constraints[0].constraint_type, ConstraintType::Horizontal { .. }));
  }

  #[test]
  fn test_extract_vertical_constraint() {
    let mut sys = ConstraintSystem::new();
    sys.add_point("p1".to_string(), Point2D::new(0.0, 0.0), false);
    sys.add_point("p2".to_string(), Point2D::new(0.0, 10.0), true);
    sys.add_line("l1".to_string(), "p1".to_string(), "p2".to_string());
    let constraints = extract_horizontal_vertical_constraints(&sys);
    assert_eq!(constraints.len(), 1);
    assert!(matches!(constraints[0].constraint_type, ConstraintType::Vertical { .. }));
  }

  #[test]
  fn test_extract_no_constraint_for_diagonal() {
    let mut sys = ConstraintSystem::new();
    sys.add_point("p1".to_string(), Point2D::new(0.0, 0.0), false);
    sys.add_point("p2".to_string(), Point2D::new(10.0, 10.0), true);
    sys.add_line("l1".to_string(), "p1".to_string(), "p2".to_string());
    let constraints = extract_horizontal_vertical_constraints(&sys);
    assert!(constraints.is_empty());
  }
}
