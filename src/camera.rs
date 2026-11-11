use crate::scene::{Camera, CanvasPoint, FrameNode, PresentationProject};

/// EaseInOutCubic curve mapping `progress` in `[0.0, 1.0]` to `[0.0, 1.0]`.
pub fn ease_in_out_cubic(progress: f32) -> f32 {
    let p = progress.clamp(0.0, 1.0);
    if p < 0.5 {
        4.0 * p * p * p
    } else {
        1.0 - (-2.0 * p + 2.0).powi(3) / 2.0
    }
}

/// Calculates the target camera state that fits `frame` within `(viewport_width, viewport_height)`
/// scaled by `padding_factor` (e.g. `0.82` for an 18% margin around the frame).
pub fn calculate_target_camera(
    frame: &FrameNode,
    viewport_width: f32,
    viewport_height: f32,
    padding_factor: f32,
) -> Camera {
    let safe_w = frame.width.max(1.0);
    let safe_h = frame.height.max(1.0);
    let scale_x = (viewport_width * padding_factor) / safe_w;
    let scale_y = (viewport_height * padding_factor) / safe_h;
    let target_zoom = scale_x.min(scale_y);

    Camera {
        center: CanvasPoint {
            x: frame.position.x + (frame.width / 2.0),
            y: frame.position.y + (frame.height / 2.0),
        },
        zoom: target_zoom,
        rotation: frame.rotation,
    }
}

/// EaseInOutCubic transition helper between two `Camera` states.
pub fn interpolate_camera(from: &Camera, to: &Camera, progress: f32) -> Camera {
    let t = if progress < 0.5 {
        4.0 * progress * progress * progress
    } else {
        1.0 - (-2.0 * progress + 2.0).powi(3) / 2.0
    };

    Camera {
        center: CanvasPoint {
            x: from.center.x + (to.center.x - from.center.x) * t,
            y: from.center.y + (to.center.y - from.center.y) * t,
        },
        zoom: from.zoom + (to.zoom - from.zoom) * t,
        rotation: from.rotation + (to.rotation - from.rotation) * t,
    }
}

/// Non-linear parabolic camera transition that zooms out at the midpoint (`t = 0.5`)
/// proportional to the world-space distance between `from` and `to`, preventing motion sickness
/// when flying between distant frames.
pub fn interpolate_camera_parabolic(from: &Camera, to: &Camera, progress: f32) -> Camera {
    let base = interpolate_camera(from, to, progress);
    let t = ease_in_out_cubic(progress);

    let distance = from.center.distance_to(&to.center);
    let avg_zoom = ((from.zoom + to.zoom) * 0.5).max(0.01);
    let apparent_pixel_travel = distance * avg_zoom;

    // Parabolic arch peaks at t = 0.5: 4 * t * (1 - t) == 1.0 at midpoint, 0.0 at endpoints
    let parabola = 4.0 * t * (1.0 - t);
    let dip_ratio = (apparent_pixel_travel / 3200.0).clamp(0.0, 0.68);
    let zoom_multiplier = 1.0 - dip_ratio * parabola;

    Camera {
        center: base.center,
        zoom: (base.zoom * zoom_multiplier).max(0.02),
        rotation: shortest_angle_lerp(from.rotation, to.rotation, t),
    }
}

fn shortest_angle_lerp(from_rad: f32, to_rad: f32, t: f32) -> f32 {
    let mut delta = (to_rad - from_rad) % std::f32::consts::TAU;
    if delta > std::f32::consts::PI {
        delta -= std::f32::consts::TAU;
    } else if delta < -std::f32::consts::PI {
        delta += std::f32::consts::TAU;
    }
    from_rad + delta * t
}

impl Camera {
    /// Calculates a camera that fits the entire `PresentationProject` bounding box.
    pub fn fit_project(
        project: &PresentationProject,
        viewport_width: f32,
        viewport_height: f32,
        padding_factor: f32,
    ) -> Self {
        if let Some((min_pt, max_pt)) = project.world_bounds() {
            let synthetic = FrameNode {
                id: "__bounds__".into(),
                title: String::new(),
                position: min_pt,
                width: (max_pt.x - min_pt.x).max(100.0),
                height: (max_pt.y - min_pt.y).max(100.0),
                rotation: 0.0,
                children_ids: vec![],
                content_blocks: vec![],
            };
            calculate_target_camera(&synthetic, viewport_width, viewport_height, padding_factor)
        } else {
            Self::default()
        }
    }

    /// Pans the camera in screen-pixel deltas (`dx_screen`, `dy_screen`).
    pub fn pan_screen_delta(&mut self, dx_screen: f32, dy_screen: f32) {
        let inv_zoom = 1.0 / self.zoom.max(0.001);
        let cos_r = self.rotation.cos();
        let sin_r = self.rotation.sin();
        let world_dx = (dx_screen * cos_r + dy_screen * sin_r) * inv_zoom;
        let world_dy = (-dx_screen * sin_r + dy_screen * cos_r) * inv_zoom;
        self.center.x -= world_dx;
        self.center.y -= world_dy;
    }

    /// Zooms the camera while keeping `screen_cursor` anchored to the same world coordinate.
    pub fn zoom_at_screen_point(
        &mut self,
        factor: f32,
        screen_cursor: CanvasPoint,
        viewport_width: f32,
        viewport_height: f32,
    ) {
        let before_world = self.screen_to_world(screen_cursor, viewport_width, viewport_height);
        self.zoom = (self.zoom * factor).clamp(0.04, 25.0);
        let after_world = self.screen_to_world(screen_cursor, viewport_width, viewport_height);
        self.center.x += before_world.x - after_world.x;
        self.center.y += before_world.y - after_world.y;
    }

    /// Converts a world coordinate `CanvasPoint` into viewport screen coordinates.
    pub fn world_to_screen(
        &self,
        world: CanvasPoint,
        viewport_width: f32,
        viewport_height: f32,
    ) -> CanvasPoint {
        let dx = (world.x - self.center.x) * self.zoom;
        let dy = (world.y - self.center.y) * self.zoom;
        let cos_r = (-self.rotation).cos();
        let sin_r = (-self.rotation).sin();
        let rx = dx * cos_r - dy * sin_r;
        let ry = dx * sin_r + dy * cos_r;
        CanvasPoint {
            x: viewport_width * 0.5 + rx,
            y: viewport_height * 0.5 + ry,
        }
    }

    /// Converts a screen coordinate `CanvasPoint` into normalized world coordinates.
    pub fn screen_to_world(
        &self,
        screen: CanvasPoint,
        viewport_width: f32,
        viewport_height: f32,
    ) -> CanvasPoint {
        let sx = screen.x - viewport_width * 0.5;
        let sy = screen.y - viewport_height * 0.5;
        let cos_r = self.rotation.cos();
        let sin_r = self.rotation.sin();
        let unrotated_x = sx * cos_r - sy * sin_r;
        let unrotated_y = sx * sin_r + sy * cos_r;
        let inv_zoom = 1.0 / self.zoom.max(0.0001);
        CanvasPoint {
            x: self.center.x + unrotated_x * inv_zoom,
            y: self.center.y + unrotated_y * inv_zoom,
        }
    }

    /// Returns a 4x4 column-major transformation matrix `[f32; 16]` suitable for GPU / CSS `matrix3d(...)`.
    pub fn to_matrix4(&self, viewport_width: f32, viewport_height: f32) -> [f32; 16] {
        let cos_r = (-self.rotation).cos() * self.zoom;
        let sin_r = (-self.rotation).sin() * self.zoom;

        let tx = viewport_width * 0.5 - (self.center.x * cos_r - self.center.y * sin_r);
        let ty = viewport_height * 0.5 - (self.center.x * sin_r + self.center.y * cos_r);

        [
            cos_r, sin_r, 0.0, 0.0, // col 0
            -sin_r, cos_r, 0.0, 0.0, // col 1
            0.0, 0.0, 1.0, 0.0, // col 2
            tx, ty, 0.0, 1.0, // col 3
        ]
    }

    /// Formats the camera transform as a hardware-accelerated CSS `matrix3d(...)` string.
    pub fn to_css_matrix3d(&self, viewport_width: f32, viewport_height: f32) -> String {
        let m = self.to_matrix4(viewport_width, viewport_height);
        format!(
            "matrix3d({:.6},{:.6},0,0,{:.6},{:.6},0,0,0,0,1,0,{:.3},{:.3},0,1)",
            m[0], m[1], m[4], m[5], m[12], m[13]
        )
    }
}
