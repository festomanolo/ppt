use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
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

/// Visual treatment of a frame on the canvas.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FrameStyle {
    #[default]
    Rect,
    Circle,
    Bracket,
    /// Invisible frames are camera stops only; they never render in present mode.
    Invisible,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct FrameNode {
    pub id: String,
    pub title: String,
    pub position: CanvasPoint,
    pub width: f32,
    pub height: f32,
    pub rotation: f32,
    #[serde(default)]
    pub children_ids: Vec<String>,
    /// Legacy inline content. `PresentationProject::normalize` migrates it into `elements`.
    #[serde(default)]
    pub content_blocks: Vec<ContentBlock>,
    #[serde(default)]
    pub style: FrameStyle,
    /// Theme color token used to fill the frame (`surface`, `accent`, `none`, ...).
    #[serde(default = "default_frame_fill")]
    pub fill_token: String,
    /// Speaker notes shown in the presenter view.
    #[serde(default)]
    pub notes: String,
}

fn default_frame_fill() -> String {
    "surface".into()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ElementKind {
    #[default]
    Text,
    Shape,
    Image,
}

/// A free-floating object placed in world space (text, vector shape or image).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct CanvasElement {
    pub id: String,
    pub kind: ElementKind,
    pub position: CanvasPoint,
    pub width: f32,
    pub height: f32,
    #[serde(default)]
    pub rotation: f32,
    #[serde(default)]
    pub text: String,
    /// `title`, `heading`, `body` or `caption`.
    #[serde(default)]
    pub text_role: String,
    #[serde(default)]
    pub font_size: f32,
    #[serde(default)]
    pub align: String,
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub italic: bool,
    #[serde(default)]
    pub color_token: String,
    /// `rect`, `ellipse`, `triangle`, `diamond`, `hexagon`, `star`, `arrow`, `line`.
    #[serde(default)]
    pub shape: String,
    #[serde(default)]
    pub fill_token: String,
    #[serde(default)]
    pub stroke_token: String,
    /// Image source: a `data:` URL or a bundle-relative asset path.
    #[serde(default)]
    pub src: String,
    #[serde(default)]
    pub opacity: Option<f32>,
    /// Hidden in present mode until the path reaches this step index.
    #[serde(default)]
    pub reveal_step: Option<u32>,
    #[serde(default)]
    pub notes: String,
}

impl CanvasElement {
    pub fn text(id: impl Into<String>, text: impl Into<String>, role: &str, x: f32, y: f32, w: f32, size: f32) -> Self {
        Self {
            id: id.into(),
            kind: ElementKind::Text,
            position: CanvasPoint::new(x, y),
            width: w,
            height: size * 1.3,
            text: text.into(),
            text_role: role.into(),
            font_size: size,
            align: "left".into(),
            bold: matches!(role, "title" | "heading"),
            color_token: if role == "caption" { "muted".into() } else { "text".into() },
            ..Default::default()
        }
    }

    pub fn shape(id: impl Into<String>, shape: &str, x: f32, y: f32, w: f32, h: f32, fill: &str) -> Self {
        Self {
            id: id.into(),
            kind: ElementKind::Shape,
            position: CanvasPoint::new(x, y),
            width: w,
            height: h,
            shape: shape.into(),
            fill_token: fill.into(),
            stroke_token: "none".into(),
            ..Default::default()
        }
    }

    pub fn centered(mut self) -> Self {
        self.align = "center".into();
        self
    }

    pub fn colored(mut self, token: &str) -> Self {
        self.color_token = token.into();
        self
    }

    pub fn revealed_at(mut self, step: u32) -> Self {
        self.reveal_step = Some(step);
        self
    }
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransitionKind {
    /// Smooth zoom-and-pan flight (zooms out over long distances).
    #[default]
    Zoom,
    /// Cross-fade to the target view.
    Fade,
    /// Instant cut.
    Cut,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SlidePathStep {
    /// Id of the frame (or element) the camera focuses on.
    pub frame_id: String,
    pub transition_duration_ms: u32,
    #[serde(default)]
    pub transition: TransitionKind,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PresentationProject {
    pub id: String,
    pub name: String,
    pub theme_id: String,
    pub frames: Vec<FrameNode>,
    pub presentation_path: Vec<SlidePathStep>,
    #[serde(default)]
    pub elements: Vec<CanvasElement>,
}

impl PresentationProject {
    pub fn new(id: impl Into<String>, name: impl Into<String>, theme_id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            theme_id: theme_id.into(),
            frames: Vec::new(),
            presentation_path: Vec::new(),
            elements: Vec::new(),
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
                transition: TransitionKind::Zoom,
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
                transition: TransitionKind::Zoom,
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
        if self.frames.is_empty() && self.elements.is_empty() {
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
        for e in &self.elements {
            min_x = min_x.min(e.position.x);
            min_y = min_y.min(e.position.y);
            max_x = max_x.max(e.position.x + e.width);
            max_y = max_y.max(e.position.y + e.height);
        }

        Some((CanvasPoint::new(min_x, min_y), CanvasPoint::new(max_x, max_y)))
    }

    /// An empty deck with a single title frame, used by "New deck".
    pub fn blank_project(id: impl Into<String>, name: impl Into<String>, theme_id: impl Into<String>) -> Self {
        let name = name.into();
        let mut project = Self::new(id, name.clone(), theme_id);
        project.add_frame(
            FrameNode {
                id: "frame-title".into(),
                title: "Title".into(),
                position: CanvasPoint::new(-800.0, -450.0),
                width: 1600.0,
                height: 900.0,
                fill_token: "surface".into(),
                ..Default::default()
            },
            true,
            1200,
        );
        project.elements.push(
            CanvasElement::text("el-title", name, "title", -650.0, -90.0, 1300.0, 110.0).centered(),
        );
        project
    }

    /// Migrates legacy `content_blocks` into free-floating `elements` laid out inside each frame,
    /// so every deck is editable with the same tools. Idempotent.
    pub fn normalize(&mut self) {
        let mut migrated = Vec::new();
        for frame in &mut self.frames {
            if frame.content_blocks.is_empty() {
                continue;
            }
            let pad = frame.width * 0.08;
            let inner_w = frame.width - pad * 2.0;
            let mut cursor_y = frame.position.y + frame.height * 0.14;
            let title_size = (frame.height * 0.11).max(14.0);
            let mut title = CanvasElement::text(
                format!("{}-title", frame.id),
                frame.title.clone(),
                "heading",
                frame.position.x + pad,
                cursor_y,
                inner_w,
                title_size,
            );
            title.rotation = frame.rotation;
            cursor_y += title_size * 1.6;
            migrated.push(title);
            for (idx, block) in frame.content_blocks.drain(..).enumerate() {
                let id = format!("{}-b{}", frame.id, idx);
                match block {
                    ContentBlock::Text { text, font_size, color_token } => {
                        let size = font_size.max(10.0) * (frame.height / 460.0).clamp(0.5, 2.0);
                        let token = match color_token.as_str() {
                            "text_muted" => "muted",
                            "primary_accent" => "accent",
                            "secondary_accent" => "accent2",
                            _ => "text",
                        };
                        let mut el = CanvasElement::text(id, text, "body", frame.position.x + pad, cursor_y, inner_w, size)
                            .colored(token);
                        el.rotation = frame.rotation;
                        cursor_y += size * 2.8;
                        migrated.push(el);
                    }
                    ContentBlock::Shape { shape_type, .. } => {
                        let d = frame.height * 0.22;
                        let shape = match shape_type.as_str() {
                            "circle" | "orbit-ring" => "ellipse",
                            "rounded-rect" => "rect",
                            "hexagon" => "hexagon",
                            "diamond" => "diamond",
                            _ => "rect",
                        };
                        let mut el = CanvasElement::shape(
                            id,
                            shape,
                            frame.position.x + frame.width - pad - d,
                            frame.position.y + frame.height - pad - d,
                            d,
                            d,
                            "accent",
                        );
                        el.opacity = Some(0.85);
                        el.rotation = frame.rotation;
                        migrated.push(el);
                    }
                    ContentBlock::Image { relative_path } => {
                        let w = frame.width * 0.32;
                        migrated.push(CanvasElement {
                            id,
                            kind: ElementKind::Image,
                            position: CanvasPoint::new(frame.position.x + pad, frame.position.y + frame.height - pad - w * 0.5),
                            width: w,
                            height: w * 0.5,
                            rotation: frame.rotation,
                            src: relative_path,
                            ..Default::default()
                        });
                    }
                }
            }
        }
        self.elements.extend(migrated);
    }

    /// Builds the curated starter deck: a title, an overview and four orbiting topics,
    /// each with nested detail frames that reveal on zoom.
    pub fn starter_project() -> Self {
        let mut p = Self::new("prezi-rs-starter", "Ideas have a shape", "tech-dark-1");

        p.add_frame(
            FrameNode {
                id: "frame-title".into(),
                title: "Title".into(),
                position: CanvasPoint::new(-700.0, -394.0),
                width: 1400.0,
                height: 788.0,
                fill_token: "surface".into(),
                notes: "Welcome everyone. This whole talk lives on one canvas.".into(),
                ..Default::default()
            },
            true,
            1200,
        );
        p.elements.push(CanvasElement::text("t-title", "Ideas have a shape", "title", -620.0, -150.0, 1240.0, 120.0).centered());
        p.elements.push(CanvasElement::shape("t-bar", "rect", -60.0, 30.0, 120.0, 10.0, "accent"));
        p.elements.push(
            CanvasElement::text("t-sub", "A tour of the zooming canvas, built to run fully offline.", "body", -560.0, 80.0, 1120.0, 34.0)
                .centered()
                .colored("muted"),
        );
        p.elements.push(
            CanvasElement::text("t-hint", "Press the right arrow to begin", "caption", -400.0, 290.0, 800.0, 22.0).centered(),
        );

        p.add_frame(
            FrameNode {
                id: "frame-overview".into(),
                title: "Overview".into(),
                position: CanvasPoint::new(-1850.0, -1850.0),
                width: 3700.0,
                height: 3700.0,
                style: FrameStyle::Invisible,
                fill_token: "none".into(),
                notes: "This is the whole map. Four ideas, each one a place we can visit.".into(),
                ..Default::default()
            },
            true,
            1400,
        );

        let topics: [(&str, &str, &str, f32, f32, [(&str, &str); 2]); 4] = [
            ("start", "Start wide", "Show the whole map first, so every detail has a place.", -1200.0, -1200.0,
                [("Overview first", "Orient before you explain"), ("Zoom for detail", "Depth carries meaning")]),
            ("zoom", "Zoom to explain", "Nest frames inside frames. Smaller means deeper.", 1200.0, -1200.0,
                [("Frames hold ideas", "Circle, box, bracket or invisible"), ("Drag to arrange", "Children move with frames")]),
            ("path", "Choose the path", "Reorder the story in the path rail. Reveal points as you go.", 1200.0, 1200.0,
                [("Reveal on step", "Bring in text when it matters"), ("Fade or fly", "Pick a transition per step")]),
            ("present", "Present anywhere", "Export one offline HTML file that plays in any browser.", -1200.0, 1200.0,
                [("Presenter view", "Notes, timer and next step"), ("Laser and blackout", "Press L or B while presenting")]),
        ];

        for (key, title, body, cx, cy, points) in topics {
            let fid = format!("frame-{}", key);
            let path_index = p.presentation_path.len() as u32;
            let mut child_ids = Vec::new();
            for (i, _) in points.iter().enumerate() {
                child_ids.push(format!("{}-p{}", fid, i + 1));
            }
            p.add_frame(
                FrameNode {
                    id: fid.clone(),
                    title: title.into(),
                    position: CanvasPoint::new(cx - 500.0, cy - 500.0),
                    width: 1000.0,
                    height: 1000.0,
                    style: FrameStyle::Circle,
                    fill_token: "surface".into(),
                    children_ids: child_ids.clone(),
                    notes: format!("{}. {}", title, body),
                    ..Default::default()
                },
                true,
                1300,
            );
            p.elements.push(CanvasElement::text(format!("{}-h", fid), title, "heading", cx - 380.0, cy - 300.0, 760.0, 72.0).centered());
            let mut body_el = CanvasElement::text(format!("{}-b", fid), body, "body", cx - 330.0, cy - 185.0, 660.0, 30.0)
                .centered()
                .colored("muted");
            if key == "path" {
                body_el = body_el.revealed_at(path_index);
            }
            p.elements.push(body_el);

            for (i, (ph, pc)) in points.iter().enumerate() {
                let px = cx - 330.0 + i as f32 * 340.0;
                let py = cy + 20.0;
                let pid = child_ids[i].clone();
                p.add_frame(
                    FrameNode {
                        id: pid.clone(),
                        title: (*ph).into(),
                        position: CanvasPoint::new(px, py),
                        width: 320.0,
                        height: 180.0,
                        fill_token: "bg".into(),
                        notes: format!("{}: {}.", ph, pc),
                        ..Default::default()
                    },
                    true,
                    900,
                );
                p.elements.push(CanvasElement::text(format!("{}-h", pid), *ph, "heading", px + 24.0, py + 44.0, 272.0, 30.0).colored("accent"));
                p.elements.push(CanvasElement::text(format!("{}-c", pid), *pc, "caption", px + 24.0, py + 96.0, 272.0, 19.0));
            }
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
