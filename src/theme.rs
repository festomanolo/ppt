use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThemePalette {
    pub id: String,
    pub name: String,
    pub category: ThemeCategory,
    pub background: String,
    pub canvas_grid: String,
    pub surface: String,
    pub primary_accent: String,
    pub secondary_accent: String,
    pub text_primary: String,
    pub text_muted: String,
    pub frame_border: String,
    pub font_family: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ThemeCategory {
    Minimalist,
    DarkTerminal,
    Academic,
    VibrantModern,
    Monochrome,
    EarthWarm,
    Cyberpunk,
    Corporate,
}

impl ThemePalette {
    /// Exports this theme palette as a block of CSS custom properties (`--bg`, `--surface`, etc.).
    pub fn to_css_variables(&self) -> String {
        format!(
            "--bg: {}; --canvas-grid: {}; --surface: {}; --primary-accent: {}; --secondary-accent: {}; --text-primary: {}; --text-muted: {}; --frame-border: {}; --font-family: {};",
            self.background,
            self.canvas_grid,
            self.surface,
            self.primary_accent,
            self.secondary_accent,
            self.text_primary,
            self.text_muted,
            self.frame_border,
            self.font_family
        )
    }
}

/// Procedurally generates 100 distinct, harmonious themes across curated color theory archetypes.
pub fn generate_100_themes() -> Vec<ThemePalette> {
    let mut themes = Vec::with_capacity(100);
    let categories = [
        ("Tech Dark", 220.0_f32, 0.15_f32, 0.08_f32),      // Base dark slate
        ("Nordic Frost", 200.0_f32, 0.20_f32, 0.95_f32),   // Base icy light
        ("Forest Botanic", 140.0_f32, 0.25_f32, 0.12_f32), // Warm organic greens
        ("Solar Flare", 35.0_f32, 0.30_f32, 0.96_f32),     // Warm creamy amber
        ("Vapor Midnight", 270.0_f32, 0.35_f32, 0.10_f32), // Deep violet
    ];

    let all_categories = [
        ThemeCategory::DarkTerminal,
        ThemeCategory::Minimalist,
        ThemeCategory::EarthWarm,
        ThemeCategory::Academic,
        ThemeCategory::Cyberpunk,
        ThemeCategory::VibrantModern,
        ThemeCategory::Corporate,
        ThemeCategory::Monochrome,
    ];

    let fonts = [
        "Inter, system-ui, sans-serif",
        "'JetBrains Mono', 'SF Mono', monospace",
        "'Plus Jakarta Sans', system-ui, sans-serif",
        "Georgia, 'Charter', serif",
        "'Space Grotesk', system-ui, sans-serif",
    ];

    for (cat_idx, (cat_name, base_hue, sat, light)) in categories.iter().enumerate() {
        for step in 0..20 {
            let hue_shift = (base_hue + (step as f32 * 18.0)) % 360.0;
            let theme_category = all_categories[(cat_idx * 2 + (step / 10)) % all_categories.len()];
            let font_family = fonts[(cat_idx + (step % 2)) % fonts.len()];

            let effective_sat = if theme_category == ThemeCategory::Monochrome {
                0.04
            } else {
                *sat
            };

            themes.push(ThemePalette {
                id: format!(
                    "{}-{}",
                    cat_name.to_lowercase().replace(' ', "-"),
                    step + 1
                ),
                name: format!("{} Variant {:02}", cat_name, step + 1),
                category: theme_category,
                background: format!(
                    "hsl({:.1}, {:.0}%, {:.0}%)",
                    hue_shift,
                    effective_sat * 100.0,
                    light * 100.0
                ),
                canvas_grid: format!("hsla({:.1}, 20%, 50%, 0.1)", hue_shift),
                surface: format!(
                    "hsl({:.1}, {:.0}%, {:.0}%)",
                    hue_shift,
                    effective_sat * 100.0,
                    (light * 100.0 + 8.0).min(98.0)
                ),
                primary_accent: format!("hsl({:.1}, 85%, 55%)", (hue_shift + 180.0) % 360.0),
                secondary_accent: format!("hsl({:.1}, 75%, 60%)", (hue_shift + 120.0) % 360.0),
                text_primary: if *light < 0.5 {
                    "#FFFFFF".into()
                } else {
                    "#111827".into()
                },
                text_muted: if *light < 0.5 {
                    "#9CA3AF".into()
                } else {
                    "#4B5563".into()
                },
                frame_border: format!("hsla({:.1}, 60%, 50%, 0.3)", hue_shift),
                font_family: font_family.into(),
            });
        }
    }
    themes
}

pub fn find_theme_by_id(id: &str) -> Option<ThemePalette> {
    generate_100_themes().into_iter().find(|t| t.id == id)
}
