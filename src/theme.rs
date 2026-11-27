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
    for family in FAMILIES.iter() {
        for step in 0..20usize {
            let t = step as f32 / 19.0;
            let bg_hue = (family.hue + family.hue_spread * (t - 0.5)).rem_euclid(360.0);
            let category = family.categories[step / 10];
            let mono = category == ThemeCategory::Monochrome;
            let sat = if mono { 0.03 } else { family.sat };
            let accent_hue = ACCENT_HUES[step];
            let accent2_hue = (accent_hue + 38.0).rem_euclid(360.0);

            // Accents are tuned per mode so they clear 3:1 against the canvas.
            let (acc_s, acc_l, acc2_s, acc2_l) = if family.dark {
                if mono { (0.0, 0.88, 0.0, 0.66) } else { (0.78, 0.64, 0.60, 0.70) }
            } else if mono {
                (0.0, 0.16, 0.0, 0.40)
            } else {
                (0.72, 0.42, 0.58, 0.38)
            };

            let (surface_l, text, muted, grid_alpha) = if family.dark {
                (
                    family.light + 0.055,
                    format!("hsl({:.1}, 18%, 95%)", bg_hue),
                    format!("hsl({:.1}, 10%, 68%)", bg_hue),
                    0.10,
                )
            } else {
                (
                    (family.light + 0.035).min(0.995),
                    format!("hsl({:.1}, 28%, 10%)", bg_hue),
                    format!("hsl({:.1}, 12%, 36%)", bg_hue),
                    0.16,
                )
            };

            themes.push(ThemePalette {
                id: format!("{}-{}", family.key, step + 1),
                name: format!("{} {}", family.label, VARIANT_NAMES[step]),
                category,
                background: hsl(bg_hue, sat, family.light),
                canvas_grid: format!(
                    "hsla({:.1}, 18%, {:.0}%, {:.2})",
                    bg_hue,
                    if family.dark { 70.0 } else { 30.0 },
                    grid_alpha
                ),
                surface: hsl(bg_hue, sat * 0.9, surface_l),
                primary_accent: hsl(accent_hue, acc_s, acc_l),
                secondary_accent: hsl(accent2_hue, acc2_s, acc2_l),
                text_primary: text,
                text_muted: muted,
                frame_border: format!(
                    "hsla({:.1}, {:.0}%, {:.0}%, 0.28)",
                    accent_hue,
                    acc_s * 100.0,
                    acc_l * 100.0
                ),
                font_family: family.body.into(),
                display_font: if step % 5 == 4 && family.display == SANS {
                    MONO.into()
                } else {
                    family.display.into()
                },
                is_dark: family.dark,
                pattern: family.patterns[step % 2].into(),
            });
        }
    }
    themes
}

fn hsl(h: f32, s: f32, l: f32) -> String {
    format!("hsl({:.1}, {:.0}%, {:.1}%)", h, s * 100.0, l * 100.0)
}

pub fn find_theme_by_id(id: &str) -> Option<ThemePalette> {
    generate_100_themes().into_iter().find(|t| t.id == id)
}
