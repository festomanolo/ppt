/* Prezi-RS engine: state, camera, rendering, scene drawing. Plain script, shared via window.P. */
(function () {
  "use strict";
  const P = (window.P = {});

  /* ---------- Utilities ---------- */
  P.$ = (sel, root = document) => root.querySelector(sel);
  P.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  P.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  P.lerp = (a, b, t) => a + (b - a) * t;
  P.uid = (prefix = "el") => prefix + "-" + Math.random().toString(36).slice(2, 9);
  P.reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  P.debounce = (fn, ms) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };
  P.icon = (name, cls = "") => {
    const inner = (window.ICONS && window.ICONS[name]) || "";
    return `<svg class="ico ${cls}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">${inner}</svg>`;
  };
  P.h = (tag, attrs = {}, html = "") => {
    const n = document.createElement(tag);
    for (const k in attrs) {
      if (k === "class") n.className = attrs[k];
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
    }
    if (html) n.innerHTML = html;
    return n;
  };
  P.esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  P.hydrateIcons = (root = document) => {
    P.$$("i[data-icon]", root).forEach((i) => { i.outerHTML = P.icon(i.dataset.icon, i.className); });
  };

  /* ---------- Event bus ---------- */
  const listeners = {};
  P.on = (ev, fn) => (listeners[ev] = listeners[ev] || []).push(fn);
  P.emit = (ev, data) => (listeners[ev] || []).forEach((fn) => fn(data));

  /* ---------- State ---------- */
  P.state = {
    project: null,
    themes: [],
    theme: null,
    cam: { x: 0, y: 0, z: 1, r: 0 },
    mode: "edit",
    tool: "select",
    shapeKind: "rect",
    selection: new Set(),
    step: -1,
    showPath: true,
    showMinimap: true,
    history: [],
    future: [],
    embed: !!window.__EMBED__,
  };
  const S = P.state;

  /* ---------- Theme ---------- */
  P.applyTheme = (id) => {
    const t = S.themes.find((x) => x.id === id) || S.themes[0];
    if (!t) return;
    S.theme = t;
    const root = document.documentElement.style;
    root.setProperty("--bg", t.background);
    root.setProperty("--surface", t.surface);
    root.setProperty("--accent", t.primary_accent);
    root.setProperty("--accent2", t.secondary_accent);
    root.setProperty("--text", t.text_primary);
    root.setProperty("--muted", t.text_muted);
    root.setProperty("--border", t.frame_border);
    root.setProperty("--grid", t.canvas_grid);
    root.setProperty("--display", t.display_font || t.font_family);
    root.setProperty("--body", t.font_family);
    document.body.dataset.chrome = t.is_dark === false ? "light" : "dark";
    const bd = P.$("#backdrop");
    bd.className = "p-" + (t.pattern || "dots");
    P.emit("theme", t);
  };

  const FILL_CSS = {
    surface: "var(--surface)",
    bg: "var(--bg)",
    accent: "color-mix(in srgb, var(--accent) 20%, var(--surface))",
    accent2: "color-mix(in srgb, var(--accent2) 20%, var(--surface))",
    "accent-solid": "var(--accent)",
    "accent2-solid": "var(--accent2)",
    text: "var(--text)",
    muted: "var(--muted)",
    none: "transparent",
  };
  P.tokenCss = (token, fallback = "var(--text)") => {
    if (!token) return fallback;
    if (token === "accent") return "var(--accent)";
    if (token === "accent2") return "var(--accent2)";
    return FILL_CSS[token] || fallback;
  };
  P.frameFillCss = (token) => FILL_CSS[token || "surface"] || "var(--surface)";
  /** Resolves a token to a concrete color string for canvas drawing. */
  P.tokenValue = (token) => {
    const t = S.theme || {};
    switch (token) {
      case "surface": return t.surface;
      case "bg": return t.background;
      case "accent": case "accent-solid": return t.primary_accent;
      case "accent2": case "accent2-solid": return t.secondary_accent;
      case "muted": return t.text_muted;
      case "none": return null;
      default: return t.text_primary;
    }
  };
  P.TOKENS = [
    { id: "text", label: "Text" },
    { id: "muted", label: "Muted" },
    { id: "accent", label: "Accent" },
    { id: "accent2", label: "Second accent" },
    { id: "surface", label: "Surface" },
    { id: "bg", label: "Background" },
  ];

  /* ---------- Scene access ---------- */
  P.frames = () => S.project.frames;
  P.elements = () => S.project.elements;
  P.get = (id) => S.project.frames.find((f) => f.id === id) || S.project.elements.find((e) => e.id === id) || null;
  P.isFrame = (o) => !!o && !("kind" in o);
  P.center = (o) => ({ x: o.position.x + o.width / 2, y: o.position.y + o.height / 2 });
  P.rot = (p, a, c = { x: 0, y: 0 }) => {
    const cs = Math.cos(a), sn = Math.sin(a), dx = p.x - c.x, dy = p.y - c.y;
    return { x: c.x + dx * cs - dy * sn, y: c.y + dx * sn + dy * cs };
  };
  P.corners = (o) => {
    const c = P.center(o), hw = o.width / 2, hh = o.height / 2, r = o.rotation || 0;
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => P.rot({ x: c.x + x, y: c.y + y }, r, c));
  };
  P.aabb = (o) => {
    const pts = P.corners(o);
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, x1, y1 };
  };
  P.boundsOf = (objs) => {
    if (!objs.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    objs.forEach((o) => { const b = P.aabb(o); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, x1, y1 };
  };
  P.allObjects = () => [...S.project.frames, ...S.project.elements];
  /** Is point p inside object o (rotation aware)? */
  P.contains = (o, p) => {
    const c = P.center(o), l = P.rot(p, -(o.rotation || 0), c);
    return Math.abs(l.x - c.x) <= o.width / 2 && Math.abs(l.y - c.y) <= o.height / 2;
  };
  /** Objects visually inside frame f (smaller, centre inside). Used so children move with frames. */
  P.childrenOf = (f) => {
    const area = f.width * f.height;
    return P.allObjects().filter((o) => o !== f && o.width * o.height < area * 0.98 && P.contains(f, P.center(o)));
  };
  P.frameOrder = () => [...S.project.frames].sort((a, b) => b.width * b.height - a.width * a.height);
  P.objTitle = (o) => {
    if (!o) return "Missing";
    if (P.isFrame(o)) return o.title || "Frame";
    if (o.kind === "text") return (o.text || "Text").split("\n")[0].slice(0, 60);
    if (o.kind === "image") return "Image";
    return (o.shape || "Shape").replace(/^\w/, (c) => c.toUpperCase());
  };

  /* ---------- Camera ---------- */
  const stage = () => P.$("#stage");
  P.vw = () => stage().clientWidth || window.innerWidth;
  P.vh = () => stage().clientHeight || window.innerHeight;
  P.worldToScreen = (p, cam = S.cam) => {
    const d = P.rot({ x: p.x - cam.x, y: p.y - cam.y }, -cam.r);
    return { x: d.x * cam.z + P.vw() / 2, y: d.y * cam.z + P.vh() / 2 };
  };
  P.screenToWorld = (s, cam = S.cam) => {
    const d = P.rot({ x: (s.x - P.vw() / 2) / cam.z, y: (s.y - P.vh() / 2) / cam.z }, cam.r);
    return { x: d.x + cam.x, y: d.y + cam.y };
  };
  P.MIN_Z = 0.0001;
  P.MAX_Z = 400;
  let camRaf = 0;
  P.applyCamera = () => {
    const c = S.cam, W = P.vw(), H = P.vh();
    P.$("#world").style.transform =
      `translate(${W / 2}px, ${H / 2}px) scale(${c.z}) rotate(${-c.r}rad) translate(${-c.x}px, ${-c.y}px)`;
    // Parallax backdrop: pattern moves at a damped rate so depth reads while zooming.
    const bd = P.$("#backdrop");
    const base = 28, lvl = Math.log2(c.z);
    const size = base * Math.pow(2, lvl - Math.floor(lvl));
    const o = P.worldToScreen({ x: 0, y: 0 });
    bd.style.backgroundSize = `${size}px ${size}px`;
    bd.style.backgroundPosition = `${o.x % size}px ${o.y % size}px`;
    if (!camRaf) camRaf = requestAnimationFrame(() => { camRaf = 0; P.emit("camera", c); });
  };
  P.setCamera = (cam) => { Object.assign(S.cam, cam); S.cam.z = P.clamp(S.cam.z, P.MIN_Z, P.MAX_Z); P.applyCamera(); };
  /** Camera that frames object/bounds `o` with the given padding (fraction of viewport used). */
  P.cameraFor = (o, pad = 0.86, W = P.vw(), H = P.vh()) => {
    const isBox = o.position;
    const w = Math.max(1, isBox ? o.width : o.w), h = Math.max(1, isBox ? o.height : o.h);
    const c = isBox ? P.center(o) : { x: o.x + o.w / 2, y: o.y + o.h / 2 };
    // Leave room for chrome in the editor so the target is not hidden behind panels.
    let padW = W * pad, padH = H * pad, offX = 0;
    if (S.mode === "edit" && !S.embed && W > 720) {
      const rail = P.$("#path-rail").classList.contains("collapsed") ? 0 : 248;
      padW = (W - rail - (P.$("#inspector").hidden ? 0 : 284)) * pad;
      padH = (H - 140) * pad;
      offX = (rail - (P.$("#inspector").hidden ? 0 : 284)) / 2;
    }
    const z = P.clamp(Math.min(padW / w, padH / h), P.MIN_Z, P.MAX_Z);
    const r = isBox ? o.rotation || 0 : 0;
    const shift = P.rot({ x: -offX / z, y: 0 }, r);
    return { x: c.x + shift.x, y: c.y + shift.y, z, r };
  };
  P.fitAll = (fly = true) => {
    const b = P.boundsOf(P.allObjects());
    if (!b) return P.flyTo({ x: 0, y: 0, z: 1, r: 0 }, { duration: fly ? 600 : 0 });
    const cam = P.cameraFor(b, 0.88);
    return fly ? P.flyTo(cam, { duration: 900 }) : P.setCamera(cam);
  };

  /* van Wijk & Nuij "smooth and efficient zooming and panning": the optimal path between two
     views zooms out over long distances and travels at constant perceived speed. */
  function zoomPath(p0, p1, rho = 1.35) {
    const [ux0, uy0, w0] = p0, [ux1, uy1, w1] = p1;
    const dx = ux1 - ux0, dy = uy1 - uy0, d2 = dx * dx + dy * dy, rho2 = rho * rho, rho4 = rho2 * rho2;
    let fn, S_;
    if (d2 < 1e-12) {
      S_ = Math.log(w1 / w0) / rho;
      fn = (t) => [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(rho * t * S_)];
    } else {
      const d1 = Math.sqrt(d2);
      const b0 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1);
      const b1 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1);
      const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
      const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
      S_ = (r1 - r0) / rho;
      fn = (t) => {
        const s = t * S_, c0 = Math.cosh(r0);
        const u = (w0 / (rho2 * d1)) * (c0 * Math.tanh(rho * s + r0) - Math.sinh(r0));
        return [ux0 + u * dx, uy0 + u * dy, (w0 * c0) / Math.cosh(rho * s + r0)];
      };
    }
    fn.length_ = Math.abs(S_);
    return fn;
  }
  P.zoomPath = zoomPath;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const angleDelta = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

  let flight = null;
  P.isFlying = () => !!flight;
  P.cancelFlight = () => {
    if (flight) { cancelAnimationFrame(flight.raf); flight.resolve(false); flight = null; P.$("#world").classList.remove("flying"); }
  };
  /** Animate the camera to `target`. kind: zoom | fade | cut. Resolves true when finished. */
  P.flyTo = (target, { duration = 1100, kind = "zoom" } = {}) => {
    P.cancelFlight();
    const from = { ...S.cam };
    const to = { ...target, z: P.clamp(target.z, P.MIN_Z, P.MAX_Z) };
    if (P.reducedMotion() && kind === "zoom") kind = "fade";
    if (kind === "cut" || duration <= 0) { P.setCamera(to); return Promise.resolve(true); }
    const world = P.$("#world");
    if (kind === "fade") {
      return new Promise((resolve) => {
        world.classList.remove("fade-in"); world.classList.add("fade-out");
        setTimeout(() => {
          P.setCamera(to);
          world.classList.remove("fade-out"); world.classList.add("fade-in");
          setTimeout(() => { world.classList.remove("fade-in"); resolve(true); }, 380);
        }, 240);
      });
    }
    const W = P.vw();
    const path = zoomPath([from.x, from.y, W / from.z], [to.x, to.y, W / to.z]);
    // Longer journeys take a little longer, but stay within a comfortable band.
    const dur = duration * P.clamp(0.7 + path.length_ * 0.16, 0.75, 1.7);
    const dr = angleDelta(from.r, to.r);
    world.classList.add("flying");
    return new Promise((resolve) => {
      const t0 = performance.now();
      flight = { resolve, raf: 0 };
      const tick = (now) => {
        const t = P.clamp((now - t0) / dur, 0, 1), e = easeInOut(t);
        const [x, y, w] = path(e);
        S.cam.x = x; S.cam.y = y; S.cam.z = W / w; S.cam.r = from.r + dr * e;
        P.applyCamera();
        if (t < 1) flight.raf = requestAnimationFrame(tick);
        else { P.setCamera(to); flight = null; world.classList.remove("flying"); resolve(true); }
      };
      flight.raf = requestAnimationFrame(tick);
    });
  };
  P.zoomAt = (factor, screenPt) => {
    P.cancelFlight();
    const before = P.screenToWorld(screenPt);
    S.cam.z = P.clamp(S.cam.z * factor, P.MIN_Z, P.MAX_Z);
    const after = P.screenToWorld(screenPt);
    S.cam.x += before.x - after.x; S.cam.y += before.y - after.y;
    P.applyCamera();
  };
  P.panBy = (dxScreen, dyScreen) => {
    const d = P.rot({ x: dxScreen / S.cam.z, y: dyScreen / S.cam.z }, S.cam.r);
    S.cam.x -= d.x; S.cam.y -= d.y;
    P.applyCamera();
  };

  /* ---------- Rendering ---------- */
  const nodes = new Map();
  P.node = (id) => nodes.get(id);

  const SHAPES = {
    rect: (w, h) => `<rect x="0" y="0" width="${w}" height="${h}" rx="${Math.min(w, h) * 0.08}"/>`,
    ellipse: (w, h) => `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}"/>`,
    triangle: (w, h) => `<polygon points="${w / 2},0 ${w},${h} 0,${h}"/>`,
    diamond: (w, h) => `<polygon points="${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}"/>`,
    hexagon: (w, h) => `<polygon points="${w * 0.25},0 ${w * 0.75},0 ${w},${h / 2} ${w * 0.75},${h} ${w * 0.25},${h} 0,${h / 2}"/>`,
    star: (w, h) => {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.4 : 1;
        pts.push(`${w / 2 + Math.cos(a) * r * w / 2},${h / 2 + Math.sin(a) * r * h / 2}`);
      }
      return `<polygon points="${pts.join(" ")}"/>`;
    },
    arrow: (w, h) => `<polygon points="0,${h * 0.32} ${w * 0.62},${h * 0.32} ${w * 0.62},0 ${w},${h / 2} ${w * 0.62},${h} ${w * 0.62},${h * 0.68} 0,${h * 0.68}"/>`,
    line: (w, h) => `<line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" stroke-linecap="round"/>`,
  };
  P.SHAPE_KINDS = [
    { id: "rect", icon: "square", label: "Rectangle" },
    { id: "ellipse", icon: "circle", label: "Ellipse" },
    { id: "triangle", icon: "triangle", label: "Triangle" },
    { id: "diamond", icon: "diamond", label: "Diamond" },
    { id: "hexagon", icon: "hexagon", label: "Hexagon" },
    { id: "star", icon: "star", label: "Star" },
    { id: "arrow", icon: "arrow-right", label: "Arrow" },
    { id: "line", icon: "line-segment", label: "Line" },
  ];
  P.ROLE_SIZE = { title: 96, heading: 56, body: 28, caption: 18 };

  function placeNode(n, o) {
    n.style.width = o.width + "px";
    n.style.transform = `translate(${o.position.x}px, ${o.position.y}px) rotate(${o.rotation || 0}rad)`;
  }

  function renderFrame(f) {
    let n = nodes.get(f.id);
    if (!n) { n = P.h("div", { "data-id": f.id }); nodes.set(f.id, n); }
    n.className = `fr s-${f.style || "rect"}`;
    placeNode(n, f);
    n.style.height = f.height + "px";
    const m = Math.min(f.width, f.height);
    n.style.setProperty("--bw", Math.max(1.5, m * 0.004) + "px");
    n.style.setProperty("--bl", m * 0.08 + "px");
    n.style.setProperty("--fill", P.frameFillCss(f.fill_token));
    n.style.borderRadius = f.style === "circle" ? "50%" : f.style === "bracket" ? "0" : m * 0.035 + "px";
    return n;
  }

  function renderElement(e) {
    let n = nodes.get(e.id);
    if (!n) { n = P.h("div", { "data-id": e.id }); nodes.set(e.id, n); }
    n.className = `el k-${e.kind}` + (e.kind === "text" ? ` r-${e.text_role || "body"}` : "") + (n.classList.contains("editing") ? " editing" : "");
    placeNode(n, e);
    n.style.opacity = e.opacity == null ? "" : e.opacity;
    if (e.kind === "text") {
      const size = e.font_size || P.ROLE_SIZE[e.text_role] || 28;
      n.style.height = "auto";
      n.style.fontSize = size + "px";
      n.style.fontWeight = e.bold ? (e.text_role === "title" ? 720 : 650) : e.text_role === "heading" ? 560 : 400;
      n.style.fontStyle = e.italic ? "italic" : "";
      n.style.textAlign = e.align || "left";
      n.style.setProperty("--tc", P.tokenCss(e.color_token));
      if (!n.classList.contains("editing") && n.textContent !== e.text) n.textContent = e.text;
    } else if (e.kind === "shape") {
      n.style.height = e.height + "px";
      const fill = e.shape === "line" ? "none" : P.tokenCss(e.fill_token, "var(--accent)");
      const strokeTok = e.shape === "line" ? e.stroke_token || e.fill_token || "accent" : e.stroke_token;
      const stroke = strokeTok && strokeTok !== "none" ? P.tokenCss(strokeTok, "var(--accent)") : "none";
      const sw = e.shape === "line" ? Math.max(2, e.height * 0.5) : Math.max(1.5, Math.min(e.width, e.height) * 0.03);
      const key = `${e.shape}|${e.width}|${e.height}|${fill}|${stroke}`;
      if (n.dataset.key !== key) {
        n.dataset.key = key;
        n.innerHTML = `<svg viewBox="0 0 ${e.width} ${e.height}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}">${(SHAPES[e.shape] || SHAPES.rect)(e.width, e.height)}</svg>`;
      }
    } else if (e.kind === "image") {
      n.style.height = e.height + "px";
      n.style.setProperty("--minside", Math.min(e.width, e.height) + "px");
      const src = e.src && !/^(data:|blob:|https?:|\/)/.test(e.src) ? "/" + e.src : e.src;
      let img = n.querySelector("img");
      if (!img) { img = P.h("img", { alt: "", draggable: "false" }); n.appendChild(img); }
      if (img.getAttribute("src") !== src) img.setAttribute("src", src || "");
    }
    return n;
  }

  /** Full render of frames and elements. Cheap enough for hundreds of objects. */
  P.render = () => {
    const fl = P.$("#frames-layer"), el = P.$("#elements-layer");
    const live = new Set();
    P.frameOrder().forEach((f) => { const n = renderFrame(f); live.add(f.id); fl.appendChild(n); });
    S.project.elements.forEach((e) => { const n = renderElement(e); live.add(e.id); el.appendChild(n); });
    for (const [id, n] of nodes) if (!live.has(id)) { n.remove(); nodes.delete(id); }
    P.measureTexts();
    P.renderPathLine();
    P.updateReveal();
    P.$("#empty-state").hidden = S.embed || S.mode !== "edit" || P.allObjects().length > 0;
    P.emit("render");
  };
  /** Re-render a single object in place (used during drags). */
  P.renderOne = (o) => {
    if (P.isFrame(o)) renderFrame(o); else renderElement(o);
    if (!P.isFrame(o) && o.kind === "text") measure(o);
  };
  function measure(e) {
    const n = nodes.get(e.id);
    if (n && n.offsetHeight) e.height = n.offsetHeight;
  }
  P.measureTexts = () => S.project.elements.forEach((e) => e.kind === "text" && measure(e));

  P.renderPathLine = () => {
    const pts = S.project.presentation_path.map((s) => P.get(s.frame_id)).filter(Boolean).map(P.center);
    const line = P.$("#path-line");
    P.$("#path-layer").classList.toggle("off", !S.showPath);
    if (pts.length < 2) { line.setAttribute("d", ""); return; }
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
      const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
      d += ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
    }
    line.setAttribute("d", d);
  };

  /** Elements with reveal_step stay hidden in present mode until the path reaches that step. */
  P.updateReveal = () => {
    const step = S.mode === "present" ? S.step : Infinity;
    S.project.elements.forEach((e) => {
      const n = nodes.get(e.id);
      if (n) n.classList.toggle("pending", e.reveal_step != null && step < e.reveal_step);
    });
  };

  /* ---------- Canvas scene drawing (thumbnails, minimap, presenter) ---------- */
  const imgCache = new Map();
  function cachedImage(src) {
    if (!src) return null;
    const url = !/^(data:|blob:|https?:|\/)/.test(src) ? "/" + src : src;
    let img = imgCache.get(url);
    if (!img) {
      img = new Image();
      img.onload = () => P.emit("image-loaded");
      img.src = url;
      imgCache.set(url, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }
  function framePath(ctx, f) {
    const w = f.width, h = f.height;
    ctx.beginPath();
    if (f.style === "circle") ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    else if (ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.035);
    else ctx.rect(-w / 2, -h / 2, w, h);
  }
  function shapePath(ctx, e) {
    const w = e.width, h = e.height, x = -w / 2, y = -h / 2;
    ctx.beginPath();
    const poly = (pts) => { pts.forEach(([px, py], i) => (i ? ctx.lineTo(x + px * w, y + py * h) : ctx.moveTo(x + px * w, y + py * h))); ctx.closePath(); };
    switch (e.shape) {
      case "ellipse": ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); break;
      case "triangle": poly([[0.5, 0], [1, 1], [0, 1]]); break;
      case "diamond": poly([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]); break;
      case "hexagon": poly([[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]]); break;
      case "arrow": poly([[0, 0.32], [0.62, 0.32], [0.62, 0], [1, 0.5], [0.62, 1], [0.62, 0.68], [0, 0.68]]); break;
      case "star": {
        const pts = [];
        for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.4 : 1; pts.push([0.5 + Math.cos(a) * r * 0.5, 0.5 + Math.sin(a) * r * 0.5]); }
        poly(pts); break;
      }
      case "line": ctx.moveTo(x, 0); ctx.lineTo(x + w, 0); break;
      default: if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.08); else ctx.rect(x, y, w, h);
    }
  }
  function wrapLines(ctx, text, maxW) {
    const out = [];
    String(text || "").split("\n").forEach((para) => {
      const words = para.split(/\s+/);
      let line = "";
      words.forEach((w) => {
        const test = line ? line + " " + w : w;
        if (ctx.measureText(test).width > maxW && line) { out.push(line); line = w; } else line = test;
      });
      out.push(line);
    });
    return out;
  }
  /**
   * Draws the scene into a 2D canvas context as seen from `cam` on a W x H viewport.
   * opts.step: reveal state; opts.schematic: skip text for tiny renders.
   */
  P.drawScene = (ctx, cam, W, H, opts = {}) => {
    const t = S.theme || {};
    ctx.save();
    ctx.fillStyle = t.background || "#111";
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    ctx.scale(cam.z, cam.z);
    ctx.rotate(-cam.r);
    ctx.translate(-cam.x, -cam.y);
    const px = 1 / cam.z;
    const viewR = Math.hypot(W, H) / 2 / cam.z;
    const visible = (o) => {
      const c = P.center(o);
      return Math.hypot(c.x - cam.x, c.y - cam.y) - Math.hypot(o.width, o.height) / 2 < viewR;
    };
    P.frameOrder().forEach((f) => {
      if (!visible(f)) return;
      const c = P.center(f);
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(f.rotation || 0);
      if (f.style === "invisible") {
        if (opts.showInvisible) { ctx.setLineDash([6 * px, 6 * px]); ctx.strokeStyle = t.text_muted; ctx.globalAlpha = 0.4; ctx.lineWidth = px; framePath(ctx, f); ctx.stroke(); }
      } else if (f.style === "bracket") {
        const bl = Math.min(f.width, f.height) * 0.08, w = f.width / 2, h = f.height / 2;
        ctx.strokeStyle = t.primary_accent; ctx.lineWidth = Math.max(px, Math.min(f.width, f.height) * 0.0064);
        ctx.beginPath();
        ctx.moveTo(-w + bl, -h); ctx.lineTo(-w, -h); ctx.lineTo(-w, h); ctx.lineTo(-w + bl, h);
        ctx.moveTo(w - bl, -h); ctx.lineTo(w, -h); ctx.lineTo(w, h); ctx.lineTo(w - bl, h);
        ctx.stroke();
      } else {
        framePath(ctx, f);
        const tok = f.fill_token || "surface";
        if (tok !== "none") {
          ctx.fillStyle = P.tokenValue(tok === "accent" || tok === "accent2" ? "surface" : tok);
          ctx.fill();
          if (tok === "accent" || tok === "accent2") { ctx.globalAlpha = 0.2; ctx.fillStyle = P.tokenValue(tok); ctx.fill(); ctx.globalAlpha = 1; }
        }
        ctx.strokeStyle = t.frame_border; ctx.lineWidth = Math.max(px * 0.8, Math.min(f.width, f.height) * 0.004);
        ctx.stroke();
      }
      ctx.restore();
    });
    S.project.elements.forEach((e) => {
      if (!visible(e)) return;
      if (opts.step != null && e.reveal_step != null && opts.step < e.reveal_step) return;
      const c = P.center(e);
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(e.rotation || 0);
      ctx.globalAlpha = e.opacity == null ? 1 : e.opacity;
      if (e.kind === "text") {
        const size = e.font_size || P.ROLE_SIZE[e.text_role] || 28;
        const color = P.tokenValue(e.color_token || "text");
        if (size * cam.z < 2.2 || opts.schematic) {
          // Too small to read: draw text as soft bars, which reads better than mush.
          ctx.fillStyle = color; ctx.globalAlpha *= 0.35;
          const lines = Math.max(1, Math.round(e.height / (size * 1.25)));
          for (let i = 0; i < Math.min(lines, 6); i++) {
            const lw = e.width * (i === lines - 1 && lines > 1 ? 0.6 : 0.92);
            const lx = e.align === "center" ? -lw / 2 : e.align === "right" ? e.width / 2 - lw : -e.width / 2;
            ctx.fillRect(lx, -e.height / 2 + i * size * 1.25 + size * 0.25, lw, size * 0.62);
          }
        } else {
          const disp = e.text_role === "title" || e.text_role === "heading";
          const family = disp ? t.display_font || t.font_family : t.font_family;
          const weight = e.bold ? 700 : e.text_role === "heading" ? 560 : 400;
          ctx.font = `${e.italic ? "italic " : ""}${weight} ${size}px ${family}`;
          ctx.fillStyle = color;
          ctx.textBaseline = "top";
          ctx.textAlign = e.align === "center" ? "center" : e.align === "right" ? "right" : "left";
          const lh = size * (disp ? 1.08 : 1.38);
          const ax = e.align === "center" ? 0 : e.align === "right" ? e.width / 2 : -e.width / 2;
          wrapLines(ctx, e.text, e.width).forEach((ln, i) => ctx.fillText(ln, ax, -e.height / 2 + i * lh + (lh - size) / 2));
        }
      } else if (e.kind === "shape") {
        shapePath(ctx, e);
        if (e.shape === "line") {
          ctx.strokeStyle = P.tokenValue(e.stroke_token || e.fill_token || "accent"); ctx.lineWidth = Math.max(2, e.height * 0.5); ctx.lineCap = "round"; ctx.stroke();
        } else {
          if (e.fill_token !== "none") { ctx.fillStyle = P.tokenValue(e.fill_token || "accent"); ctx.fill(); }
          if (e.stroke_token && e.stroke_token !== "none") { ctx.strokeStyle = P.tokenValue(e.stroke_token); ctx.lineWidth = Math.max(1.5, Math.min(e.width, e.height) * 0.03); ctx.stroke(); }
        }
      } else if (e.kind === "image") {
        const img = cachedImage(e.src);
        if (img) {
          // object-fit: cover
          const ir = img.naturalWidth / img.naturalHeight, br = e.width / e.height;
          let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
          if (ir > br) { sw = sh * br; sx = (img.naturalWidth - sw) / 2; } else { sh = sw / br; sy = (img.naturalHeight - sh) / 2; }
          ctx.drawImage(img, sx, sy, sw, sh, -e.width / 2, -e.height / 2, e.width, e.height);
        } else { ctx.fillStyle = t.surface; ctx.fillRect(-e.width / 2, -e.height / 2, e.width, e.height); }
      }
      ctx.restore();
    });
    ctx.restore();
  };
  /** Camera for path step i, computed for an arbitrary viewport size. */
  P.stepCamera = (i, W = P.vw(), H = P.vh(), pad = 0.86) => {
    const s = S.project.presentation_path[i];
    const o = s && P.get(s.frame_id);
    if (!o) return null;
    const saved = S.mode;
    S.mode = "present"; // thumbnails and presenting share framing without editor chrome offsets
    const cam = P.cameraFor(o, P.isFrame(o) ? pad : 0.6, W, H);
    S.mode = saved;
    return cam;
  };
  P.drawStepThumb = (canvas, i, opts = {}) => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.clientWidth || 200, H = canvas.clientHeight || Math.round(W * 9 / 16);
    if (canvas.width !== W * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cam = P.stepCamera(i, W, H, 0.9);
    if (!cam) { ctx.fillStyle = (S.theme || {}).background || "#111"; ctx.fillRect(0, 0, W, H); return; }
    P.drawScene(ctx, cam, W, H, { step: opts.revealAll ? null : i, ...opts });
  };

  /* ---------- History & persistence ---------- */
  const snapshot = () => JSON.stringify(S.project);
  P.checkpoint = () => {
    const snap = snapshot();
    if (S.history[S.history.length - 1] !== snap) S.history.push(snap);
    if (S.history.length > 200) S.history.shift();
    S.future = [];
  };
  P.undo = () => {
    if (!S.history.length) return P.toast("Nothing to undo", "arrow-counter-clockwise");
    S.future.push(snapshot());
    S.project = JSON.parse(S.history.pop());
    afterRestore();
  };
  P.redo = () => {
    if (!S.future.length) return P.toast("Nothing to redo", "arrow-clockwise");
    S.history.push(snapshot());
    S.project = JSON.parse(S.future.pop());
    afterRestore();
  };
  function afterRestore() {
    [...S.selection].forEach((id) => !P.get(id) && S.selection.delete(id));
    P.applyTheme(S.project.theme_id);
    P.changed({ structure: true });
    P.emit("selection");
  }
  /** Call after mutating the project. */
  P.changed = (opts = {}) => {
    if (opts.structure !== false) P.render();
    P.emit("project", opts);
    P.scheduleSave();
  };

  const setSaveState = (txt, cls = "") => {
    const n = P.$("#save-state");
    if (n) { n.textContent = txt; n.className = "save-state " + cls; }
  };
  let saving = null, dirty = false, lastSaved = "";
  /** True when the deck has edits the server has not confirmed. */
  P.hasUnsaved = () => !S.embed && !!S.project && snapshot() !== lastSaved;
  P.markSaved = () => { lastSaved = snapshot(); };
  P.save = async () => {
    if (S.embed) return;
    if (saving) { dirty = true; return; }
    setSaveState("Saving", "busy");
    const body = snapshot();
    saving = fetch("/api/project", { method: "PUT", headers: { "Content-Type": "application/json" }, body })
      .then((r) => { if (!r.ok) throw new Error(r.status); lastSaved = body; setSaveState("Saved"); try { localStorage.removeItem("prezi-rs-backup"); } catch (_) {} })
      .catch(() => {
        try { localStorage.setItem("prezi-rs-backup", body); } catch (_) {}
        setSaveState("Offline, kept locally", "warn");
      })
      .finally(() => { saving = null; if (dirty) { dirty = false; P.save(); } });
    return saving;
  };
  /** Saves immediately and waits for the server to confirm. */
  P.flush = async () => { await P.save(); if (saving) await saving; };
  P.scheduleSave = P.debounce(P.save, 450);
  P.api = async (url, opts = {}) => {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error((await r.text()) || r.statusText);
    return r.json();
  };

  /* ---------- Toasts & tooltips ---------- */
  P.toast = (msg, icon = "check") => {
    const t = P.h("div", { class: "toast" }, P.icon(icon) + `<span>${P.esc(msg)}</span>`);
    P.$("#toast-layer").appendChild(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 240); }, 2400);
  };
})();
