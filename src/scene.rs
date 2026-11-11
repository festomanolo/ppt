use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CanvasPoint {
    pub x: f32,
    pub y: f32,
}

impl CanvasPoint {
    pub fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }

    pub fn distance_to(&self, other: &CanvasPoint) -> f32 {
        let dx = self.x - other.x;
        let dy = self.y - other.y;
        (dx * dx + dy * dy).sqrt()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Camera {
    pub center: CanvasPoint,
    pub zoom: f32,     // Scale factor (1.0 = 100%)
    pub rotation: f32, // Radians
}

impl Default for Camera {
    fn default() -> Self {
        Self {
            center: CanvasPoint { x: 0.0, y: 0.0 },
            zoom: 1.0,
            rotation: 0.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FrameNode {
    pub id: String,
    pub title: String,
    pub position: CanvasPoint,
    pub width: f32,
    pub height: f32,
    pub rotation: f32,
    pub children_ids: Vec<String>,
    pub content_blocks: Vec<ContentBlock>,
}

impl FrameNode {
    pub fn center(&self) -> CanvasPoint {
        CanvasPoint {
            x: self.position.x + self.width / 2.0,
            y: self.position.y + self.height / 2.0,
        }
    }

    /// Checks whether a point in world coordinates falls inside this frame (accounting for rotation around center).
    pub fn contains_point(&self, point: CanvasPoint) -> bool {
        let center = self.center();
        let dx = point.x - center.x;
        let dy = point.y - center.y;
        let cos_r = (-self.rotation).cos();
        let sin_r = (-self.rotation).sin();
        let local_x = dx * cos_r - dy * sin_r;
        let local_y = dx * sin_r + dy * cos_r;
        local_x.abs() <= self.width / 2.0 && local_y.abs() <= self.height / 2.0
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ContentBlock {
    Text {
        text: String,
        font_size: f32,
        color_token: String,
    },
    Shape {
        shape_type: String,
        stroke: f32,
    },
    Image {
        relative_path: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SlidePathStep {
    pub frame_id: String,
    pub transition_duration_ms: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PresentationProject {
    pub id: String,
    pub name: String,
    pub theme_id: String,
    pub frames: Vec<FrameNode>,
    pub presentation_path: Vec<SlidePathStep>,
}

impl PresentationProject {
    pub fn new(id: impl Into<String>, name: impl Into<String>, theme_id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            theme_id: theme_id.into(),
            frames: Vec::new(),
            presentation_path: Vec::new(),
        }
    }

    pub fn get_frame(&self, frame_id: &str) -> Option<&FrameNode> {
        self.frames.iter().find(|f| f.id == frame_id)
    }

    pub fn get_frame_mut(&mut self, frame_id: &str) -> Option<&mut FrameNode> {
        self.frames.iter_mut().find(|f| f.id == frame_id)
    }

    /// Adds a root or standalone frame to the project and optionally appends it to the presentation path.
    pub fn add_frame(&mut self, frame: FrameNode, add_to_path: bool, duration_ms: u32) {
        let frame_id = frame.id.clone();
        self.frames.push(frame);
        if add_to_path {
            self.presentation_path.push(SlidePathStep {
                frame_id,
                transition_duration_ms: duration_ms,
            });
        }
    }

    /// Adds a child subtopic frame linked to `parent_id` in the hierarchical scene graph.
    pub fn add_subtopic_frame(
        &mut self,
        parent_id: &str,
        subtopic: FrameNode,
        add_to_path: bool,
        duration_ms: u32,
    ) -> Result<(), String> {
        let child_id = subtopic.id.clone();
        let parent = self
            .frames
            .iter_mut()
            .find(|f| f.id == parent_id)
            .ok_or_else(|| format!("Parent frame '{}' not found", parent_id))?;

        if !parent.children_ids.contains(&child_id) {
            parent.children_ids.push(child_id.clone());
        }
        self.frames.push(subtopic);
        if add_to_path {
            self.presentation_path.push(SlidePathStep {
                frame_id: child_id,
                transition_duration_ms: duration_ms,
            });
        }
        Ok(())
    }

    /// Removes a frame and cleans up parent references and presentation path steps.
    pub fn remove_frame(&mut self, frame_id: &str) -> bool {
        let initial_len = self.frames.len();
        self.frames.retain(|f| f.id != frame_id);
        if self.frames.len() == initial_len {
            return false;
        }
        for frame in &mut self.frames {
            frame.children_ids.retain(|cid| cid != frame_id);
        }
        self.presentation_path.retain(|step| step.frame_id != frame_id);
        true
    }

    /// Returns the depth-first traversal order of the hierarchical scene graph starting from root frames.
    pub fn hierarchical_traversal(&self) -> Vec<&FrameNode> {
        let mut child_set = std::collections::HashSet::new();
        let mut by_id: HashMap<&str, &FrameNode> = HashMap::new();
        for frame in &self.frames {
            by_id.insert(&frame.id, frame);
            for cid in &frame.children_ids {
                child_set.insert(cid.as_str());
            }
        }

        let mut visited = std::collections::HashSet::new();
        let mut ordered = Vec::with_capacity(self.frames.len());

        fn visit<'a>(
            node: &'a FrameNode,
            by_id: &HashMap<&str, &'a FrameNode>,
            visited: &mut std::collections::HashSet<&'a str>,
            ordered: &mut Vec<&'a FrameNode>,
        ) {
            if !visited.insert(node.id.as_str()) {
                return;
            }
            ordered.push(node);
            for cid in &node.children_ids {
                if let Some(child) = by_id.get(cid.as_str()) {
                    visit(child, by_id, visited, ordered);
                }
            }
        }

        for frame in &self.frames {
            if !child_set.contains(frame.id.as_str()) {
                visit(frame, &by_id, &mut visited, &mut ordered);
            }
        }
        for frame in &self.frames {
            if !visited.contains(frame.id.as_str()) {
                visit(frame, &by_id, &mut visited, &mut ordered);
            }
        }
        ordered
    }

    /// Performs hit-testing in reverse render order (deepest/last frame first).
    pub fn hit_test(&self, world_point: CanvasPoint) -> Option<&FrameNode> {
        self.frames
            .iter()
            .rev()
            .find(|f| f.contains_point(world_point))
    }

    /// Computes a world-space bounding box `(min_point, max_point)` encompassing all frames.
    pub fn world_bounds(&self) -> Option<(CanvasPoint, CanvasPoint)> {
        if self.frames.is_empty() {
            return None;
        }
        let mut min_x = f32::MAX;
        let mut min_y = f32::MAX;
        let mut max_x = f32::MIN;
        let mut max_y = f32::MIN;

        for f in &self.frames {
            min_x = min_x.min(f.position.x);
            min_y = min_y.min(f.position.y);
            max_x = max_x.max(f.position.x + f.width);
            max_y = max_y.max(f.position.y + f.height);
        }

        Some((CanvasPoint::new(min_x, min_y), CanvasPoint::new(max_x, max_y)))
    }

    /// Builds a curated starter project with hierarchical topics and subtopics.
    pub fn starter_project() -> Self {
        let mut project = Self::new(
            "prezi-rs-starter",
            "Prezi-RS Zooming Architecture Deck",
            "tech-dark-1",
        );

        let overview = FrameNode {
            id: "frame-overview".into(),
            title: "1. Infinite Canvas Overview".into(),
            position: CanvasPoint::new(-600.0, -360.0),
            width: 1200.0,
            height: 720.0,
            rotation: 0.0,
            children_ids: vec![
                "frame-engine".into(),
                "frame-camera".into(),
                "frame-themes".into(),
                "frame-storage".into(),
            ],
            content_blocks: vec![
                ContentBlock::Text {
                    text: "Offline-First Zooming Presentation Engine in Rust".into(),
                    font_size: 38.0,
                    color_token: "text_primary".into(),
                },
                ContentBlock::Text {
                    text: "Deterministic hierarchical scene graph • Parabolic camera easing • 100 procedural themes • SQLite + .prezi-rs ZIP bundles".into(),
                    font_size: 20.0,
                    color_token: "text_muted".into(),
                },
                ContentBlock::Shape {
                    shape_type: "orbit-ring".into(),
                    stroke: 2.5,
                },
            ],
        };
        project.add_frame(overview, true, 1200);

        let topics = [
            (
                "frame-engine",
                "2. Hierarchical Scene Graph",
                CanvasPoint::new(-1850.0, -1100.0),
                760.0,
                460.0,
                -0.06,
                "Normalized world coordinates with nested topic & subtopic trees",
                "circle",
            ),
            (
                "frame-camera",
                "3. Parabolic Zoom Camera",
                CanvasPoint::new(1150.0, -1080.0),
                760.0,
                460.0,
                0.06,
                "Non-linear EaseInOutCubic + distance-aware zoom-out trajectory",
                "rounded-rect",
            ),
            (
                "frame-themes",
                "4. 100-Theme Procedural Engine",
                CanvasPoint::new(-1820.0, 680.0),
                760.0,
                460.0,
                0.05,
                "HSL color-theory generator across 8 curated visual archetypes",
                "hexagon",
            ),
            (
                "frame-storage",
                "5. Offline Storage & ZIP Bundler",
                CanvasPoint::new(1150.0, 680.0),
                760.0,
                460.0,
                -0.05,
                "Embedded SQLite undo/redo history + .prezi-rs deflated archives",
                "diamond",
            ),
        ];

        for (id, title, pos, w, h, rot, desc, shape) in topics {
            let sub_id = format!("{}-sub", id);
            let node = FrameNode {
                id: id.into(),
                title: title.into(),
                position: pos,
                width: w,
                height: h,
                rotation: rot,
                children_ids: vec![sub_id.clone()],
                content_blocks: vec![
                    ContentBlock::Text {
                        text: desc.into(),
                        font_size: 22.0,
                        color_token: "text_primary".into(),
                    },
                    ContentBlock::Shape {
                        shape_type: shape.into(),
                        stroke: 2.0,
                    },
                ],
            };
            project.add_frame(node, true, 1100);

            let sub_node = FrameNode {
                id: sub_id,
                title: format!("Deep Dive: {}", &title[3..]),
                position: CanvasPoint::new(pos.x + w * 0.62, pos.y + h * 0.62),
                width: 320.0,
                height: 200.0,
                rotation: rot * 1.5,
                children_ids: vec![],
                content_blocks: vec![
                    ContentBlock::Text {
                        text: "Subtopic detail node at 2.5x deeper zoom scale".into(),
                        font_size: 14.0,
                        color_token: "secondary_accent".into(),
                    },
                    ContentBlock::Image {
                        relative_path: "assets/diagram.svg".into(),
                    },
                ],
            };
            project.add_frame(sub_node, true, 900);
        }

        // Return to overview at the end of the presentation path
        project.presentation_path.push(SlidePathStep {
            frame_id: "frame-overview".into(),
            transition_duration_ms: 1400,
        });

        project
    }

    /// Generates a 50-frame hierarchical spiral galaxy project to test high-performance pan/zoom rendering.
    pub fn generate_50_frame_showcase() -> Self {
        let mut project = Self::new(
            "prezi-rs-50-frames",
            "50-Frame Spiral Stress Benchmark",
            "vapor-midnight-1",
        );

        // 1 Root central hub + 7 main topic clusters * 7 frames (1 cluster head + 6 subtopics) = 50 frames total
        let hub = FrameNode {
            id: "frame-001".into(),
            title: "Central Mission Control (Frame 01/50)".into(),
            position: CanvasPoint::new(-500.0, -300.0),
            width: 1000.0,
            height: 600.0,
            rotation: 0.0,
            children_ids: (0..7).map(|i| format!("frame-{:03}", 2 + i * 7)).collect(),
            content_blocks: vec![
                ContentBlock::Text {
                    text: "50-Frame Hierarchical Scene Graph Benchmark".into(),
                    font_size: 34.0,
                    color_token: "text_primary".into(),
                },
                ContentBlock::Text {
                    text: "7 Orbital Topic Clusters × 6 Nested Subtopics + Central Hub = 50 Nodes".into(),
                    font_size: 18.0,
                    color_token: "primary_accent".into(),
                },
                ContentBlock::Shape {
                    shape_type: "orbit-ring".into(),
                    stroke: 3.0,
                },
            ],
        };
        project.add_frame(hub, true, 1000);

        let mut frame_counter = 2usize;
        for cluster_idx in 0..7 {
            let angle = (cluster_idx as f32) * std::f32::consts::TAU / 7.0;
            let radius = 2600.0;
            let cluster_cx = angle.cos() * radius;
            let cluster_cy = angle.sin() * radius;
            let cluster_id = format!("frame-{:03}", frame_counter);
            let cluster_num = frame_counter;
            frame_counter += 1;

            let mut sub_ids = Vec::with_capacity(6);
            let mut sub_nodes = Vec::with_capacity(6);

            for sub_idx in 0..6 {
                let sub_id = format!("frame-{:03}", frame_counter);
                let sub_num = frame_counter;
                frame_counter += 1;
                sub_ids.push(sub_id.clone());

                let sub_angle = angle + (sub_idx as f32 - 2.5) * 0.42;
                let sub_radius = 680.0 + (sub_idx as f32 % 2.0) * 180.0;
                let sub_cx = cluster_cx + sub_angle.cos() * sub_radius;
                let sub_cy = cluster_cy + sub_angle.sin() * sub_radius;

                sub_nodes.push(FrameNode {
                    id: sub_id,
                    title: format!("Subtopic {:02} (Cluster {})", sub_num, cluster_idx + 1),
                    position: CanvasPoint::new(sub_cx - 160.0, sub_cy - 100.0),
                    width: 320.0,
                    height: 200.0,
                    rotation: (sub_angle * 0.15).sin() * 0.18,
                    children_ids: vec![],
                    content_blocks: vec![
                        ContentBlock::Text {
                            text: format!(
                                "Node #{:02} • World ({:.0}, {:.0})",
                                sub_num, sub_cx, sub_cy
                            ),
                            font_size: 14.0,
                            color_token: "text_muted".into(),
                        },
                        ContentBlock::Shape {
                            shape_type: if sub_idx % 2 == 0 {
                                "rounded-rect".into()
                            } else {
                                "circle".into()
                            },
                            stroke: 1.5,
                        },
                    ],
                });
            }

            let cluster_node = FrameNode {
                id: cluster_id,
                title: format!(
                    "Topic Cluster {} (Frame {:02}/50)",
                    cluster_idx + 1,
                    cluster_num
                ),
                position: CanvasPoint::new(cluster_cx - 340.0, cluster_cy - 210.0),
                width: 680.0,
                height: 420.0,
                rotation: (angle * 0.25).sin() * 0.12,
                children_ids: sub_ids,
                content_blocks: vec![
                    ContentBlock::Text {
                        text: format!(
                            "Sector {} Primary Hub • 6 Linked Subtopic Nodes",
                            cluster_idx + 1
                        ),
                        font_size: 22.0,
                        color_token: "text_primary".into(),
                    },
                    ContentBlock::Shape {
                        shape_type: "hexagon".into(),
                        stroke: 2.5,
                    },
                ],
            };

            project.add_frame(cluster_node, true, 950);
            for sub in sub_nodes {
                project.add_frame(sub, true, 650);
            }
        }

        project
    }
}
