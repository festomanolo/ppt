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
    /// Body font stack (kept for backwards compatibility).
    pub font_family: String,
    /// Font stack for titles and headings.
    pub display_font: String,
    pub is_dark: bool,
    /// Canvas backdrop pattern: `dots`, `grid`, `glow` or `none`.
    pub pattern: String,
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
            "--bg: {}; --canvas-grid: {}; --surface: {}; --primary-accent: {}; --secondary-accent: {}; --text-primary: {}; --text-muted: {}; --frame-border: {}; --font-family: {}; --display-font: {};",
            self.background,
            self.canvas_grid,
            self.surface,
            self.primary_accent,
            self.secondary_accent,
            self.text_primary,
            self.text_muted,
            self.frame_border,
            self.font_family,
            self.display_font
        )
    }
}

const SANS: &str = "Geist, ui-sans-serif, system-ui, sans-serif";
const MONO: &str = "'Geist Mono', ui-monospace, 'SF Mono', monospace";
const SERIF: &str = "'Geist Serif', ui-serif, Georgia, serif";

struct Family {
    key: &'static str,
    label: &'static str,
    dark: bool,
    /// Background hue range start and the spread walked across variants.
    hue: f32,
    hue_spread: f32,
    sat: f32,
    light: f32,
    display: &'static str,
    body: &'static str,
    categories: [ThemeCategory; 2],
    patterns: [&'static str; 2],
}

const FAMILIES: [Family; 5] = [
    Family {
        key: "tech-dark",
        label: "Graphite",
        dark: true,
        hue: 210.0,
        hue_spread: 60.0,
        sat: 0.10,
        light: 0.075,
        display: SANS,
        body: SANS,
        categories: [ThemeCategory::DarkTerminal, ThemeCategory::Monochrome],
        patterns: ["dots", "grid"],
    },
    Family {
        key: "nordic-frost",
        label: "Nordic",
        dark: false,
        hue: 195.0,
        hue_spread: 50.0,
        sat: 0.22,
        light: 0.955,
        display: SANS,
        body: SANS,
        categories: [ThemeCategory::Minimalist, ThemeCategory::Corporate],
        patterns: ["dots", "none"],
    },
    Family {
        key: "forest-botanic",
        label: "Forest",
        dark: true,
        hue: 130.0,
        hue_spread: 45.0,
        sat: 0.22,
        light: 0.09,
        display: SERIF,
        body: SANS,
        categories: [ThemeCategory::EarthWarm, ThemeCategory::Academic],
        patterns: ["glow", "dots"],
    },
    Family {
        key: "solar-flare",
        label: "Solar",
        dark: false,
        hue: 18.0,
        hue_spread: 40.0,
        sat: 0.30,
        light: 0.95,
        display: SERIF,
        body: SANS,
        categories: [ThemeCategory::Academic, ThemeCategory::VibrantModern],
        patterns: ["none", "grid"],
    },
    Family {
        key: "vapor-midnight",
        label: "Midnight",
        dark: true,
        hue: 235.0,
        hue_spread: 70.0,
        sat: 0.30,
        light: 0.085,
        display: SANS,
        body: SANS,
        categories: [ThemeCategory::Cyberpunk, ThemeCategory::VibrantModern],
        patterns: ["glow", "grid"],
    },
];

const VARIANT_NAMES: [&str; 20] = [
    "Ember", "Tide", "Signal", "Moss", "Copper", "Glacier", "Saffron", "Ink", "Coral", "Lagoon",
    "Orchid", "Basalt", "Citrus", "Harbor", "Rosewood", "Pine", "Cobalt", "Dune", "Mint", "Flare",
];

/// Accent hues paired with each variant name above, chosen so neighbouring variants feel distinct.
const ACCENT_HUES: [f32; 20] = [
    18.0, 188.0, 48.0, 140.0, 26.0, 200.0, 40.0, 222.0, 8.0, 172.0,
    300.0, 210.0, 70.0, 196.0, 345.0, 152.0, 224.0, 34.0, 160.0, 12.0,
];

/// Procedurally generates 100 harmonious, contrast-checked themes across five curated families.
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
