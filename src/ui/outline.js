/* Prezi-RS outline builder: turns plain notes into a spatial deck with a camera path. */
(function () {
  "use strict";
  const P = window.P, S = P.state, $ = P.$, $$ = P.$$, h = P.h, icon = P.icon, esc = P.esc;

  const EXAMPLE = `# Launching Atlas

Why now: The market moved and we can move faster
  - Customers want offline: Planes, trains, field sites
  - Rivals are cloud only: Their weakness is our wedge
The product: One canvas, every idea in its place
  - Zoom for depth
  - Present anywhere: A single HTML file
The plan: Three quarters, three milestones
  - Q1 private beta
  - Q2 public launch
  - Q3 teams
Ask: What we need from this room`;

  /* ---------- Parsing ----------
     "# Title" names the deck. Top-level lines (or "## ") are topics, indented lines (or "### ")
     are points under the last topic, and anything deeper becomes that point's detail.
     "Head: detail" splits a line into a heading and a supporting sentence. */
  function splitHead(text) {
    const m = text.match(/^(.{1,70}?)\s*(?::\s+|\s[—–-]\s)(.+)$/);
    return m ? { head: m[1].trim(), detail: m[2].trim() } : { head: text.trim(), detail: "" };
  }
  function parse(src) {
    let title = "";
    const topics = [];
    let pointIndent = null;
    String(src || "").replace(/\t/g, "  ").split("\n").forEach((raw) => {
      if (!raw.trim()) return;
      const indent = raw.match(/^\s*/)[0].length;
      let line = raw.trim(), level;
      const hm = line.match(/^(#{1,6})\s+(.*)$/);
      if (hm) {
        level = Math.min(3, hm[1].length);
        line = hm[2];
      } else {
        line = line.replace(/^([-*+•]|\d+[.)])\s+/, "");
        if (indent === 0) level = 2;
        else if (pointIndent == null || indent <= pointIndent) level = 3;
        else level = 4;
      }
      if (!line) return;
      const topic = topics[topics.length - 1];
      if (level === 1 && !title) title = line;
      else if (level <= 2) { topics.push({ ...splitHead(line), points: [] }); pointIndent = null; }
      else if (!topic) topics.push({ ...splitHead(line), points: [] });
      else if (level === 3 || !topic.points.length) {
        if (pointIndent == null) pointIndent = indent;
        topic.points.push(splitHead(line));
      } else {
        const pt = topic.points[topic.points.length - 1];
        pt.detail = pt.detail ? pt.detail + " " + line : line;
      }
    });
    // A single top-level line with children reads as a title over its topics.
    if (!title && topics.length === 1 && topics[0].points.length > 1) {
      const only = topics[0];
      return { title: only.head, subtitle: only.detail, topics: only.points.map((p) => ({ head: p.head, detail: p.detail, points: [] })) };
    }
    return { title, subtitle: "", topics };
  }
  P.parseOutline = parse;

  /* ---------- Object factories (local coordinates, centred on 0,0) ---------- */
  const estLines = (text, size, width) => Math.max(1, Math.ceil((String(text).length * size * 0.52) / Math.max(1, width)));
  function T(text, role, x, y, w, size, extra = {}) {
    const lh = role === "title" || role === "heading" ? 1.1 : 1.38;
    return {
      id: P.uid("text"), kind: "text", position: { x, y }, width: w, height: estLines(text, size, w) * size * lh, rotation: 0,
      text, text_role: role, font_size: size, align: "center", bold: role === "title" || role === "heading", italic: false,
      color_token: role === "caption" || role === "body" ? "muted" : "text", shape: "", fill_token: "", stroke_token: "", src: "",
      opacity: null, reveal_step: null, notes: "", ...extra,
    };
  }
  function F(title, cx, cy, w, hh, extra = {}) {
    return { id: P.uid("frame"), title, position: { x: cx - w / 2, y: cy - hh / 2 }, width: w, height: hh, rotation: 0, children_ids: [], content_blocks: [], style: "rect", fill_token: "surface", notes: "", ...extra };
  }
  function Sh(shape, cx, cy, w, hh, extra = {}) {
    return { id: P.uid("shape"), kind: "shape", position: { x: cx - w / 2, y: cy - hh / 2 }, width: w, height: hh, rotation: 0, text: "", text_role: "", font_size: 0, align: "", bold: false, italic: false, color_token: "", shape, fill_token: "accent", stroke_token: "none", src: "", opacity: null, reveal_step: null, notes: "", ...extra };
  }
  /** Scales, rotates and moves a group of objects built around (0,0). */
  function place(objs, cx, cy, rot = 0, scale = 1) {
    objs.forEach((o) => {
      const c = P.center(o);
      const p = P.rot({ x: c.x * scale, y: c.y * scale }, rot);
      o.width *= scale; o.height *= scale;
      if (o.font_size) o.font_size *= scale;
      o.position.x = cx + p.x - o.width / 2;
      o.position.y = cy + p.y - o.height / 2;
      o.rotation = (o.rotation || 0) + rot;
    });
    return objs;
  }

  /**
   * Lays a topic out inside a W x H frame centred on (0,0). `area` is the usable content box in
   * local coordinates. Returns { frame, objs, points } where points are the point frames.
   */
  function topicGroup(topic, W, H, { style = "rect", area, fill = "surface" } = {}) {
    const frame = F(topic.head, 0, 0, W, H, { style, fill_token: fill, notes: topic.detail || "" });
    const objs = [frame], points = [];
    const ax = area.x, ay = area.y, aw = area.w, ah = area.h;
    const hs = Math.min(ah * (topic.points.length ? 0.11 : 0.16), aw * 0.085);
    let y = ay;
    if (!topic.points.length) y = ay + ah * 0.32;
    const head = T(topic.head, "heading", ax, y, aw, hs);
    objs.push(head);
    y += head.height + hs * 0.5;
    if (topic.detail) {
      const bs = hs * 0.42;
      const body = T(topic.detail, "body", ax + aw * 0.08, y, aw * 0.84, bs);
      objs.push(body);
      y += body.height + bs * 1.2;
    }
    const n = topic.points.length;
    if (n) {
      y += hs * 0.4;
      const cols = n <= 3 ? n : n === 4 ? 2 : 3, rows = Math.ceil(n / cols);
      const gap = aw * 0.035;
      const cw = (aw - gap * (cols - 1)) / cols;
      const availH = ay + ah - y;
      const ch = Math.max(availH * 0.2, Math.min((availH - gap * (rows - 1)) / rows, cw * 0.62));
      const gridH = rows * ch + (rows - 1) * gap;
      const y0 = y + Math.max(0, (availH - gridH) / 2);
      topic.points.forEach((pt, i) => {
        const r = Math.floor(i / cols), c = i % cols;
        const inRow = Math.min(cols, n - r * cols);
        const rowW = inRow * cw + (inRow - 1) * gap;
        const px = ax + (aw - rowW) / 2 + c * (cw + gap) + cw / 2;
        const py = y0 + r * (ch + gap) + ch / 2;
        const pf = F(pt.head, px, py, cw, ch, { fill_token: "bg", notes: pt.detail || "" });
        objs.push(pf);
        points.push(pf);
        const ps = Math.min(ch * (pt.detail ? 0.17 : 0.22), cw * 0.1);
        const pad = cw * 0.08;
        const ph = T(pt.head, "heading", px - cw / 2 + pad, 0, cw - pad * 2, ps, { color_token: "accent", align: "left" });
        const block = [ph];
        if (pt.detail) block.push(T(pt.detail, "caption", px - cw / 2 + pad, 0, cw - pad * 2, ps * 0.56, { align: "left" }));
        const total = block.reduce((s, b) => s + b.height, 0) + (block.length - 1) * ps * 0.45;
        let by = py - total / 2;
        block.forEach((b) => { b.position.y = by; by += b.height + ps * 0.45; objs.push(b); });
      });
    }
    return { frame, objs, points };
  }

  function titleGroup(title, subtitle, W, H) {
    const frame = F("Title", 0, 0, W, H, { notes: subtitle || "" });
    const ts = H * 0.12;
    const t = T(title || "Untitled", "title", -W * 0.4, 0, W * 0.8, ts);
    const sub = subtitle ? T(subtitle, "body", -W * 0.34, 0, W * 0.68, ts * 0.3) : null;
    const bar = Sh("rect", 0, 0, W * 0.07, H * 0.011);
    const total = t.height + ts * 0.5 + bar.height + (sub ? ts * 0.5 + sub.height : 0);
    let y = -total / 2;
    t.position.y = y; y += t.height + ts * 0.5;
    bar.position.y = y; y += bar.height;
    if (sub) { y += ts * 0.5; sub.position.y = y; }
    return { frame, objs: sub ? [frame, t, bar, sub] : [frame, t, bar] };
  }

  /* ---------- Layouts ---------- */
  const LAYOUTS = [
    { id: "orbit", icon: "target", t: "Orbit", d: "Topics circle the title. Zoom out to see the whole map." },
    { id: "journey", icon: "arrow-right", t: "Journey", d: "A path that moves left to right, one stop per topic." },
    { id: "grid", icon: "squares-four", t: "Board", d: "Topics on a tidy board under the title." },
    { id: "dive", icon: "stack", t: "Deep dive", d: "Each topic sits inside the last. Every step zooms deeper.", max: 6 },
  ];

  function build(outline, layout) {
    const frames = [], elements = [];
    const add = (objs) => objs.forEach((o) => (P.isFrame(o) ? frames : elements).push(o));
    const pathIds = [];
    const title = titleGroup(outline.title, outline.subtitle || (outline.topics.length ? outline.topics.map((t) => t.head).slice(0, 4).join("  ·  ") : ""), 1600, 900);
    const topics = outline.topics;

    if (layout === "dive") {
      // Title holds topic 1, topic 1 holds topic 2, and so on. Each level is 30% of its parent.
      const k = 0.3;
      const levels = [title];
      add(title.objs);
      pathIds.push(title.frame.id);
      title.objs.slice(1).forEach((o) => { o.position.y -= 900 * 0.16; });
      let parentScale = 1, parentCy = 0;
      topics.forEach((tp, i) => {
        const hasNext = i < topics.length - 1;
        const W = 1600, H = 900;
        const area = hasNext ? { x: -W * 0.43, y: -H * 0.42, w: W * 0.86, h: H * 0.52 } : { x: -W * 0.43, y: -H * 0.4, w: W * 0.86, h: H * 0.8 };
        const g = topicGroup(tp, W, H, { area, fill: i % 2 ? "surface" : "bg" });
        // Slot in the parent: bottom centre.
        const scale = parentScale * k;
        const cy = parentCy + 900 * parentScale * 0.27;
        place(g.objs, 0, cy, 0, scale);
        add(g.objs);
        pathIds.push(g.frame.id, ...g.points.map((p) => p.id));
        levels.push(g);
        parentScale = scale;
        parentCy = cy;
      });
      // End by pulling all the way back out.
      pathIds.push(title.frame.id);
      return finish(frames, elements, pathIds, null);
    }

    add(title.objs);
    const groups = [];
    if (layout === "orbit") {
      const D = 1000, n = Math.max(1, topics.length);
      const R = Math.max(1750, (n * D * 1.3) / (Math.PI * 2));
      topics.forEach((tp, i) => {
        const g = topicGroup(tp, D, D, { style: "circle", area: { x: -D * 0.34, y: -D * 0.3, w: D * 0.68, h: D * 0.62 } });
        const a = -Math.PI / 2 + (i * Math.PI * 2) / n + (n % 2 ? 0 : Math.PI / n);
        place(g.objs, Math.cos(a) * R, Math.sin(a) * R * 0.78);
        groups.push(g);
      });
    } else if (layout === "journey") {
      const W = 1600, H = 1000, gap = 520;
      const end = topics.length * (W + gap);
      const line = Sh("line", end / 2, 0, end + W, 10, { fill_token: "none", stroke_token: "accent", opacity: 0.35 });
      elements.unshift(line);
      topics.forEach((tp, i) => {
        const g = topicGroup(tp, W, H, { area: { x: -W * 0.42, y: -H * 0.38, w: W * 0.84, h: H * 0.76 } });
        place(g.objs, (i + 1) * (W + gap), (i % 2 ? 1 : -1) * H * 0.16, (i % 2 ? 1 : -1) * 0.035);
        groups.push(g);
      });
    } else {
      const W = 1600, H = 1000, gap = 220, cols = Math.max(1, Math.ceil(Math.sqrt(topics.length)));
      const rows = Math.ceil(topics.length / cols);
      const gw = cols * W + (cols - 1) * gap;
      topics.forEach((tp, i) => {
        const g = topicGroup(tp, W, H, { area: { x: -W * 0.42, y: -H * 0.38, w: W * 0.84, h: H * 0.76 } });
        const r = Math.floor(i / cols), c = i % cols;
        place(g.objs, -gw / 2 + W / 2 + c * (W + gap), 900 / 2 + 360 + H / 2 + r * (H + gap));
        groups.push(g);
      });
      if (rows) place(title.objs, 0, 0, 0, Math.max(1, gw / 1600 * 0.62));
    }
    groups.forEach((g) => add(g.objs));
    pathIds.push(title.frame.id);
    const overviewAt = groups.length > 1 ? 1 : -1;
    groups.forEach((g) => pathIds.push(g.frame.id, ...g.points.map((p) => p.id)));
    return finish(frames, elements, pathIds, overviewAt);
  }

  /** Adds an invisible overview frame around everything and assembles the path. */
  function finish(frames, elements, pathIds, overviewAt) {
    const b = P.boundsOf([...frames, ...elements]);
    if (overviewAt != null && b) {
      const pad = Math.max(b.w, b.h) * 0.04;
      const ov = F("Overview", b.x + b.w / 2, b.y + b.h / 2, b.w + pad * 2, b.h + pad * 2, { style: "invisible", fill_token: "none", notes: "The whole map." });
      frames.push(ov);
      if (overviewAt >= 0) pathIds.splice(overviewAt, 0, ov.id);
      pathIds.push(ov.id);
    }
    const path = pathIds.map((id, i) => ({ frame_id: id, transition_duration_ms: i === 0 ? 1200 : 1100, transition: "zoom" }));
    return { frames, elements, path };
  }
  P.buildOutline = build;

  /* ---------- Dialog ---------- */
  const STORE = "prezi-rs-outline";
  P.openOutline = (arg) => {
    const fresh = !!(arg && arg.fresh);
    const pasted = typeof arg === "string" ? arg : "";
    let saved = "";
    try { saved = localStorage.getItem(STORE) || ""; } catch (_) {}
    const isBlankCanvas = S.project.elements.length <= 1 && S.project.frames.length <= 1;
    let layout = "orbit", mode = fresh || isBlankCanvas ? "replace" : "add";

    const dlg = h("div", { class: "dialog wide", role: "dialog", "aria-label": "Build from outline" });
    dlg.innerHTML = `
      <div class="dlg-head"><h2>Build from outline</h2><button class="icon-btn sm" data-x aria-label="Close">${icon("x")}</button></div>
      <div class="dlg-body"><div class="outline-grid">
        <div class="outline-left">
          <textarea class="input" spellcheck="false" aria-label="Outline" placeholder="# Deck title&#10;Topic: one line about it&#10;  - Point: supporting detail&#10;  - Another point&#10;Next topic"></textarea>
          <div class="outline-help"><span>Top-level lines become topics. Indent to add points. <kbd>Tab</kbd> indents.</span><button class="link-btn" data-example>Use an example</button></div>
        </div>
        <div class="outline-right">
          <div class="insp-label">Layout</div>
          <div class="layout-opts" role="radiogroup" aria-label="Layout"></div>
          <canvas class="outline-canvas" aria-label="Layout preview"></canvas>
          <div class="outline-preview" aria-live="polite"></div>
        </div>
      </div></div>
      <div class="dlg-foot"><div class="foot-left"></div><div class="row"><button class="btn btn-ghost" data-x>Cancel</button><button class="btn btn-primary" data-build>${icon("magic-wand")}Build<kbd class="kbd-on-accent">⌘↵</kbd></button></div></div>`;
    const ta = dlg.querySelector("textarea");
    ta.value = pasted || saved;
    const opts = dlg.querySelector(".layout-opts");
    const canvas = dlg.querySelector(".outline-canvas");
    const summary = dlg.querySelector(".outline-preview");
    const buildBtn = dlg.querySelector("[data-build]");

    LAYOUTS.forEach((l) => {
      const b = h("button", { class: "layout-opt" + (l.id === layout ? " on" : ""), role: "radio", "aria-checked": l.id === layout, "data-l": l.id }, `${icon(l.icon)}<span class="t">${l.t}</span><span class="d">${l.d}</span>`);
      b.onclick = () => { if (b.disabled) return; layout = l.id; $$(".layout-opt", opts).forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-checked", x === b); }); refresh(); };
      opts.appendChild(b);
    });

    if (!fresh) {
      const segEl = h("div", { class: "seg", role: "radiogroup", "aria-label": "Where to build", style: "width:260px" });
      [["replace", "Replace canvas"], ["add", "Add beside"]].forEach(([id, label]) => {
        const b = h("button", { class: id === mode ? "on" : "", role: "radio", "aria-checked": id === mode }, label);
        b.onclick = () => { mode = id; $$("button", segEl).forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-checked", x === b); }); };
        segEl.appendChild(b);
      });
      dlg.querySelector(".foot-left").appendChild(segEl);
    } else dlg.querySelector(".foot-left").innerHTML = `<span class="hint">Creates a new deck</span>`;

    let gen = null, outline = null;
    const refresh = () => {
      outline = parse(ta.value);
      const n = outline.topics.length, pts = outline.topics.reduce((s, t) => s + t.points.length, 0);
      $$(".layout-opt", opts).forEach((b) => {
        const l = LAYOUTS.find((x) => x.id === b.dataset.l);
        const off = l.max && n > l.max;
        b.disabled = off;
        b.classList.toggle("off", off);
        b.title = off ? `Works with up to ${l.max} topics` : "";
      });
      if (LAYOUTS.find((l) => l.id === layout).max < n) { layout = "orbit"; $$(".layout-opt", opts).forEach((x) => x.classList.toggle("on", x.dataset.l === "orbit")); }
      if (!n) {
        gen = null;
        summary.textContent = "Write at least one topic to see a preview.";
        buildBtn.disabled = true;
        drawPreview(null);
        return;
      }
      gen = build(outline, layout);
      buildBtn.disabled = false;
      summary.innerHTML = `<b>${esc(outline.title || S.project.name)}</b>: ${n} topic${n === 1 ? "" : "s"}, ${pts} point${pts === 1 ? "" : "s"}, ${gen.path.length} camera stops`;
      drawPreview(gen);
    };
    function drawPreview(g) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = canvas.clientWidth || 320, H = canvas.clientHeight || 200;
      canvas.width = W * dpr; canvas.height = H * dpr;
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!g) { ctx.fillStyle = (S.theme || {}).background || "#111"; ctx.fillRect(0, 0, W, H); return; }
      const saved = S.project;
      S.project = { ...saved, frames: g.frames, elements: g.elements, presentation_path: g.path };
      try {
        const b = P.boundsOf([...g.frames, ...g.elements]);
        const z = Math.min((W * 0.92) / b.w, (H * 0.9) / b.h);
        const cam = { x: b.x + b.w / 2, y: b.y + b.h / 2, z, r: 0 };
        P.drawScene(ctx, cam, W, H, {});
        // Path line, as the camera will travel it.
        const pts = g.path.map((s) => P.get(s.frame_id)).filter(Boolean).map((o) => P.center(o)).map((p) => ({ x: (p.x - cam.x) * z + W / 2, y: (p.y - cam.y) * z + H / 2 }));
        ctx.strokeStyle = (S.theme || {}).primary_accent || "#888";
        ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
        ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      } finally { S.project = saved; }
    }

    const close = P.openDialog(dlg);
    $$("[data-x]", dlg).forEach((b) => (b.onclick = close));
    dlg.querySelector("[data-example]").onclick = () => { ta.value = EXAMPLE; refresh(); ta.focus(); };
    const persist = P.debounce(() => { try { localStorage.setItem(STORE, ta.value); } catch (_) {} }, 300);
    const refreshSoon = P.debounce(refresh, 120);
    ta.addEventListener("input", () => { refreshSoon(); persist(); });
    ta.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); buildBtn.click(); return; }
      if (e.key === "Tab") {
        e.preventDefault();
        const v = ta.value, s = ta.selectionStart, en = ta.selectionEnd;
        const ls = v.lastIndexOf("\n", s - 1) + 1;
        if (e.shiftKey) {
          const strip = v.slice(ls, ls + 2).match(/^ {1,2}/);
          if (!strip) return;
          const n = strip[0].length;
          ta.value = v.slice(0, ls) + v.slice(ls + n);
          ta.selectionStart = Math.max(ls, s - n); ta.selectionEnd = Math.max(ls, en - n);
        } else {
          ta.value = v.slice(0, ls) + "  " + v.slice(ls);
          ta.selectionStart = s + 2; ta.selectionEnd = en + 2;
        }
        refreshSoon(); persist();
      }
    });
    buildBtn.onclick = async () => {
      if (!gen) return;
      buildBtn.disabled = true;
      const result = gen, ol = outline;
      close();
      if (fresh) {
        try {
          await P.flush();
          P.loadProject(await P.api("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template: "blank", name: ol.title || "Untitled deck", theme_id: S.project.theme_id }) }));
        } catch (_) { return P.toast("Could not create the deck", "x"); }
      }
      apply(result, ol, fresh ? "replace" : mode);
    };
    refresh();
    requestAnimationFrame(() => { drawPreview(gen); ta.focus(); });
  };

  function apply(gen, outline, mode) {
    P.checkpoint();
    const p = S.project;
    if (mode === "replace") {
      p.frames = gen.frames;
      p.elements = gen.elements;
      p.presentation_path = gen.path;
      if (outline.title) p.name = outline.title;
    } else {
      const cur = P.boundsOf(P.allObjects());
      const nb = P.boundsOf([...gen.frames, ...gen.elements]);
      if (cur && nb) {
        const dx = cur.x1 + Math.max(cur.w, nb.w) * 0.25 - nb.x, dy = cur.y + cur.h / 2 - (nb.y + nb.h / 2);
        [...gen.frames, ...gen.elements].forEach((o) => { o.position.x += dx; o.position.y += dy; });
      }
      const base = p.presentation_path.length;
      p.frames.push(...gen.frames);
      p.elements.push(...gen.elements);
      p.presentation_path.push(...gen.path);
      p.elements.forEach((e) => { if (e.reveal_step != null && e.reveal_step >= base + gen.path.length) e.reveal_step = null; });
    }
    S.selection.clear();
    S.step = mode === "replace" ? 0 : p.presentation_path.length - gen.path.length;
    P.changed();
    P.emit("selection");
    const first = P.get(gen.path[0] && gen.path[0].frame_id);
    const all = P.boundsOf([...gen.frames, ...gen.elements]);
    // Show the whole new map, then settle on the first stop.
    P.flyTo(P.cameraFor(all, 0.9), { duration: 900 }).then((ok) => {
      if (ok && first) setTimeout(() => !P.isFlying() && S.mode === "edit" && P.flyTo(P.cameraFor(first), { duration: 1000 }), 650);
    });
    P.toast(`Built ${gen.path.length} camera stops. Press Present to play.`, "magic-wand");
  }
})();
