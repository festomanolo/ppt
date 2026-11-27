/* Prezi-RS editor: tools, selection, inspector, path rail, menus, palette, minimap. */
(function () {
  "use strict";
  const P = window.P, S = P.state, $ = P.$, $$ = P.$$, h = P.h, icon = P.icon, esc = P.esc;

  /* ================= Commands ================= */
  P.commands = [];
  const cmd = (id, label, run, opts = {}) => P.commands.push({ id, label, run, icon: opts.icon, kbd: opts.kbd, hidden: opts.hidden });
  P.run = (id, arg) => { const c = P.commands.find((x) => x.id === id); if (c) c.run(arg); };

  /* ================= Selection ================= */
  P.select = (ids, { add = false } = {}) => {
    if (!add) S.selection.clear();
    (Array.isArray(ids) ? ids : [ids]).forEach((id) => id && S.selection.add(id));
    P.emit("selection");
  };
  P.selected = () => [...S.selection].map(P.get).filter(Boolean);
  P.clearSelection = () => { if (S.selection.size) { S.selection.clear(); P.emit("selection"); } };

  /* ================= Overlay: labels, badges, selection ================= */
  const labelPool = new Map();
  let overlayRaf = 0;
  P.requestOverlay = () => { if (!overlayRaf) overlayRaf = requestAnimationFrame(() => { overlayRaf = 0; renderOverlay(); }); };

  function stepIndexMap() {
    const m = new Map();
    S.project.presentation_path.forEach((s, i) => { if (!m.has(s.frame_id)) m.set(s.frame_id, []); m.get(s.frame_id).push(i + 1); });
    return m;
  }

  function renderOverlay() {
    if (S.mode !== "edit" || !S.project) return;
    const W = P.vw(), H = P.vh(), z = S.cam.z;
    const steps = stepIndexMap();
    const host = $("#labels");
    const live = new Set();
    const place = (key, cls, html, x, y, rot, extra = "") => {
      let n = labelPool.get(key);
      if (!n) { n = h("div", { class: cls }); host.appendChild(n); labelPool.set(key, n); }
      if (n._html !== html) { n.innerHTML = html; n._html = html; }
      n.className = cls;
      n.style.transform = `translate(${x}px, ${y}px) rotate(${rot}rad)${extra}`;
      live.add(key);
      return n;
    };
    P.frames().forEach((f) => {
      const sw = f.width * z, sh = f.height * z;
      if (sw < 64 || sw > W * 6) return;
      const c = P.worldToScreen(P.center(f));
      if (c.x + sw < -100 || c.x - sw > W + 100 || c.y + sh < -100 || c.y - sh > H + 100) return;
      const tl = P.worldToScreen(P.corners(f)[f.style === "circle" ? 0 : 0]);
      const rot = (f.rotation || 0) - S.cam.r;
      const n = place("l:" + f.id, "f-label" + (S.selection.has(f.id) ? " sel" : ""), esc(f.title || "Frame"), tl.x, tl.y, rot, " translateY(calc(-100% - 6px))");
      n.dataset.id = f.id;
    });
    P.allObjects().forEach((o) => {
      const nums = steps.get(o.id);
      if (!nums) return;
      if (o.width * z < 30) return;
      const tr = P.worldToScreen(P.corners(o)[1]);
      if (tr.x < -40 || tr.x > W + 40 || tr.y < -40 || tr.y > H + 40) return;
      const label = nums.length > 3 ? nums.slice(0, 3).join(", ") + "…" : nums.join(", ");
      place("b:" + o.id, "step-badge", label, tr.x, tr.y, 0, " translate(-50%, -50%)");
    });
    for (const [k, n] of labelPool) if (!live.has(k)) { n.remove(); labelPool.delete(k); }
    renderSelection();
  }

  function boxStyle(o) {
    const c = P.worldToScreen(P.center(o));
    const w = o.width * S.cam.z, hh = o.height * S.cam.z;
    return { w, h: hh, css: `width:${w}px;height:${hh}px;transform:translate(${c.x - w / 2}px, ${c.y - hh / 2}px) rotate(${(o.rotation || 0) - S.cam.r}rad)` };
  }

  function renderSelection() {
    const host = $("#selection");
    const sel = P.selected();
    if (!sel.length || editingId) { host.innerHTML = ""; return; }
    let html = "";
    if (sel.length === 1) {
      const o = sel[0], b = boxStyle(o);
      const isText = !P.isFrame(o) && o.kind === "text";
      let hs = isText ? ["nw", "ne", "se", "sw", "e", "w"] : ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
      if (b.w < 28 || b.h < 28) hs = ["se"];
      const pos = { nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50], se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50] };
      html += `<div class="sel-box" style="${b.css}">`;
      hs.forEach((k) => { html += `<div class="hdl" data-h="${k}" style="left:${pos[k][0]}%;top:${pos[k][1]}%"></div>`; });
      html += `<div class="rot-stem"></div><div class="hdl rot" data-h="rot" style="left:50%;top:-22px"></div>`;
      if (dragInfo) html += `<div class="size-tag">${dragInfo}</div>`;
      html += `</div>`;
    } else {
      sel.forEach((o) => { html += `<div class="sel-box ghost" style="${boxStyle(o).css}"></div>`; });
      const bb = P.boundsOf(sel);
      const a = P.worldToScreen({ x: bb.x, y: bb.y }), c = P.worldToScreen({ x: bb.x1, y: bb.y1 });
      if (Math.abs(S.cam.r) < 1e-6) html += `<div class="sel-box group" style="width:${c.x - a.x}px;height:${c.y - a.y}px;transform:translate(${a.x}px,${a.y}px)"></div>`;
    }
    host.innerHTML = html;
  }

  function showGuides(lines) {
    const g = $("#guides");
    g.innerHTML = lines.map((l) => (l.v ? `<div class="guide v" style="left:${l.v}px"></div>` : `<div class="guide h" style="top:${l.h}px"></div>`)).join("");
  }

  /* ================= Pointer interaction ================= */
  let drag = null;
  let dragInfo = "";
  let spaceDown = false;
  let editingId = null;
  const pointers = new Map();
  let pinch = null;

  const stage = $("#stage");
  const local = (e) => ({ x: e.clientX, y: e.clientY });

  function hitObject(target) {
    const n = target.closest && target.closest("#world [data-id]");
    return n ? P.get(n.dataset.id) : null;
  }

  stage.addEventListener("pointerdown", (e) => {
    if (S.mode !== "edit") return;
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      drag = null;
      return;
    }
    if (editingId) {
      if (e.target.closest(`[data-id="${editingId}"]`)) return;
      finishEditing();
    }
    closePopovers();
    if (e.button === 2) return;
    stage.setPointerCapture(e.pointerId);
    const pt = local(e);
    const world = P.screenToWorld(pt);
    const base = { start: pt, last: pt, startWorld: world, moved: false, shift: e.shiftKey, alt: e.altKey };

    const hdl = e.target.closest(".hdl");
    if (hdl) {
      const o = P.selected()[0];
      P.checkpoint();
      drag = { ...base, type: hdl.dataset.h === "rot" ? "rotate" : "resize", handle: hdl.dataset.h, obj: o, orig: snapshotObj(o), kids: P.isFrame(o) ? P.childrenOf(o).map((k) => ({ o: k, s: snapshotObj(k) })) : [] };
      return;
    }
    if (e.button === 1 || spaceDown || S.tool === "hand") { drag = { ...base, type: "pan" }; stage.classList.add("panning"); return; }
    if (S.tool === "frame" || S.tool === "shape" || S.tool === "text") { drag = { ...base, type: "create", tool: S.tool }; return; }

    const label = e.target.closest(".f-label");
    const obj = label ? P.get(label.dataset.id) : hitObject(e.target);
    if (obj) {
      const big = P.isFrame(obj) && !label && obj.width * S.cam.z > P.vw() * 0.85 && obj.height * S.cam.z > P.vh() * 0.85;
      if (big && !S.selection.has(obj.id)) { drag = { ...base, type: "pan", clickSelect: obj.id }; return; }
      if (e.shiftKey) {
        if (S.selection.has(obj.id)) S.selection.delete(obj.id); else S.selection.add(obj.id);
        P.emit("selection");
      } else if (!S.selection.has(obj.id)) P.select(obj.id);
      drag = { ...base, type: "move", clickId: obj.id };
      return;
    }
    if (e.shiftKey) { drag = { ...base, type: "marquee" }; return; }
    drag = { ...base, type: "pan", clear: true };
  });

  stage.addEventListener("pointermove", (e) => {
    if (S.mode !== "edit") return;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, local(e));
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      P.panBy(mid.x - pinch.mid.x, mid.y - pinch.mid.y);
      P.zoomAt(d / pinch.d, mid);
      pinch = { d, mid };
      return;
    }
    if (!drag) return;
    const pt = local(e);
    if (!drag.moved && Math.hypot(pt.x - drag.start.x, pt.y - drag.start.y) < 3) return;
    const first = !drag.moved;
    drag.moved = true;
    const world = P.screenToWorld(pt);
    switch (drag.type) {
      case "pan": P.panBy(pt.x - drag.last.x, pt.y - drag.last.y); break;
      case "move": doMove(world, first, e); break;
      case "resize": doResize(world, e); break;
      case "rotate": doRotate(world, e); break;
      case "marquee": doMarquee(pt); break;
      case "create": doCreatePreview(pt); break;
    }
    drag.last = pt;
  });

  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!drag || S.mode !== "edit") return;
    const d = drag;
    drag = null;
    dragInfo = "";
    stage.classList.remove("panning");
    showGuides([]);
    $("#marquee").hidden = true;
    if (d.type === "pan" && !d.moved) {
      if (d.clickSelect) P.select(d.clickSelect);
      else if (d.clear) P.clearSelection();
    }
    if (d.type === "move" && !d.moved && !d.shift && S.selection.size > 1) P.select(d.clickId);
    if ((d.type === "move" || d.type === "resize" || d.type === "rotate") && d.moved) P.changed({ structure: d.type !== "move" });
    if (d.type === "marquee") finishMarquee(d);
    if (d.type === "create") finishCreate(d, local(e));
    P.requestOverlay();
  };
  stage.addEventListener("pointerup", endPointer);
  stage.addEventListener("pointercancel", endPointer);
  stage.addEventListener("contextmenu", (e) => { if (S.mode === "edit") e.preventDefault(); });

  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (S.mode === "present") return P.presentWheel && P.presentWheel(e);
    wheelNav(e);
  }, { passive: false });

  /** Trackpads pan with two fingers and pinch with ctrlKey; mouse wheels zoom. */
  function wheelNav(e) {
    P.cancelFlight();
    const pt = local(e);
    const lineMode = e.deltaMode === 1;
    const mouseWheel = lineMode || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY));
    if (e.ctrlKey || e.metaKey || mouseWheel) {
      const dy = lineMode ? e.deltaY * 16 : e.deltaY;
      P.zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0022)), pt);
    } else P.panBy(-e.deltaX, -e.deltaY);
  }
  P.wheelNav = wheelNav;

  stage.addEventListener("dblclick", (e) => {
    if (S.mode !== "edit") return;
    const obj = hitObject(e.target) || (e.target.closest(".f-label") && P.get(e.target.closest(".f-label").dataset.id));
    if (obj && !P.isFrame(obj) && obj.kind === "text") return startEditing(obj.id);
    if (obj) { P.select(obj.id); return P.flyTo(P.cameraFor(obj), { duration: 900 }); }
    const w = P.screenToWorld(local(e));
    createText(w);
  });

  function snapshotObj(o) {
    return { x: o.position.x, y: o.position.y, w: o.width, h: o.height, r: o.rotation || 0, fs: o.font_size };
  }

  /* ---- move with snapping ---- */
  function doMove(world, first, e) {
    if (first) {
      P.checkpoint();
      if (drag.alt) {
        const clones = duplicateObjects(P.selected(), 0);
        P.select(clones.map((c) => c.id));
        P.render();
      }
      const set = new Map();
      P.selected().forEach((o) => {
        set.set(o.id, o);
        if (P.isFrame(o)) P.childrenOf(o).forEach((k) => set.set(k.id, k));
      });
      drag.moving = [...set.values()].map((o) => ({ o, x: o.position.x, y: o.position.y }));
      const movingIds = new Set(set.keys());
      drag.targets = P.allObjects().filter((o) => !movingIds.has(o.id)).map(P.aabb);
      drag.selBox = P.boundsOf(P.selected());
    }
    let dx = world.x - drag.startWorld.x, dy = world.y - drag.startWorld.y;
    const lines = [];
    if (!e.metaKey && !e.ctrlKey && drag.selBox && Math.abs(S.cam.r) < 1e-6) {
      const tol = 6 / S.cam.z, b = drag.selBox;
      const xs = [b.x + dx, b.x + b.w / 2 + dx, b.x1 + dx], ys = [b.y + dy, b.y + b.h / 2 + dy, b.y1 + dy];
      let bestX = null, bestY = null;
      drag.targets.forEach((t) => {
        [t.x, t.x + t.w / 2, t.x1].forEach((tx) => xs.forEach((x) => { const d = tx - x; if (Math.abs(d) < tol && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, at: tx }; }));
        [t.y, t.y + t.h / 2, t.y1].forEach((ty) => ys.forEach((y) => { const d = ty - y; if (Math.abs(d) < tol && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, at: ty }; }));
      });
      if (bestX) { dx += bestX.d; lines.push({ v: P.worldToScreen({ x: bestX.at, y: 0 }).x }); }
      if (bestY) { dy += bestY.d; lines.push({ h: P.worldToScreen({ x: 0, y: bestY.at }).y }); }
    }
    showGuides(lines);
    drag.moving.forEach((m) => { m.o.position.x = m.x + dx; m.o.position.y = m.y + dy; P.renderOne(m.o); });
    P.renderPathLine();
    P.requestOverlay();
  }

  /* ---- resize ---- */
  const HS = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] };
  function doResize(world, e) {
    const o = drag.obj, s0 = drag.orig, [sx, sy] = HS[drag.handle];
    const r = s0.r, c0 = { x: s0.x + s0.w / 2, y: s0.y + s0.h / 2 };
    const anchor = P.rot({ x: c0.x - (sx * s0.w) / 2, y: c0.y - (sy * s0.h) / 2 }, r, c0);
    const d = P.rot({ x: world.x - anchor.x, y: world.y - anchor.y }, -r);
    const min = 8 / S.cam.z;
    let nw = sx ? Math.max(min, d.x * sx) : s0.w;
    let nh = sy ? Math.max(min, d.y * sy) : s0.h;
    const isText = !P.isFrame(o) && o.kind === "text";
    const isImage = !P.isFrame(o) && o.kind === "image";
    const corner = sx && sy;
    const keep = corner && (e.shiftKey !== (isImage || isText || P.isFrame(o)));
    let scale = 1;
    if (keep || (isText && corner)) {
      scale = Math.max(nw / s0.w, nh / s0.h);
      nw = s0.w * scale; nh = s0.h * scale;
    }
    const nc = { x: anchor.x, y: anchor.y };
    const off = P.rot({ x: (sx * nw) / 2, y: (sy * nh) / 2 }, r);
    nc.x += off.x; nc.y += off.y;
    o.width = nw;
    o.height = nh;
    o.position.x = nc.x - nw / 2;
    o.position.y = nc.y - nh / 2;
    if (isText && corner) o.font_size = Math.max(1, (s0.fs || P.ROLE_SIZE[o.text_role] || 28) * scale);
    // Corner-scaling a frame scales what it contains, like zooming a whole idea.
    if (P.isFrame(o) && corner && keep) {
      drag.kids.forEach(({ o: k, s }) => {
        const kc = { x: s.x + s.w / 2, y: s.y + s.h / 2 };
        const ncx = anchor.x + (kc.x - anchor.x) * scale, ncy = anchor.y + (kc.y - anchor.y) * scale;
        k.width = s.w * scale; k.height = s.h * scale;
        k.position.x = ncx - k.width / 2; k.position.y = ncy - k.height / 2;
        if (s.fs) k.font_size = s.fs * scale;
        P.renderOne(k);
      });
    }
    P.renderOne(o);
    dragInfo = `${Math.round(o.width)} × ${Math.round(o.height)}`;
    P.requestOverlay();
  }

  /* ---- rotate ---- */
  function doRotate(world, e) {
    const o = drag.obj, s0 = drag.orig, c = { x: s0.x + s0.w / 2, y: s0.y + s0.h / 2 };
    let a = Math.atan2(world.y - c.y, world.x - c.x) + Math.PI / 2;
    const step = Math.PI / 12;
    if (e.shiftKey) a = Math.round(a / step) * step;
    else if (Math.abs(((a + Math.PI) % (Math.PI * 2)) - Math.PI) < 0.05) a = 0;
    const da = a - s0.r;
    o.rotation = a;
    drag.kids.forEach(({ o: k, s }) => {
      const kc = P.rot({ x: s.x + s.w / 2, y: s.y + s.h / 2 }, da, c);
      k.position.x = kc.x - s.w / 2; k.position.y = kc.y - s.h / 2; k.rotation = s.r + da;
      P.renderOne(k);
    });
    P.renderOne(o);
    let deg = Math.round(((a * 180) / Math.PI) % 360);
    if (deg > 180) deg -= 360;
    dragInfo = `${deg}°`;
    P.requestOverlay();
  }

  /* ---- marquee ---- */
  function doMarquee(pt) {
    const m = $("#marquee"), a = drag.start;
    m.hidden = false;
    m.style.cssText = `left:${Math.min(a.x, pt.x)}px;top:${Math.min(a.y, pt.y)}px;width:${Math.abs(pt.x - a.x)}px;height:${Math.abs(pt.y - a.y)}px`;
  }
  function finishMarquee(d) {
    if (!d.moved) return;
    const a = d.start, b = d.last;
    const pts = [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }].map((p) => P.screenToWorld(p));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const r = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    const hits = P.allObjects().filter((o) => { const bb = P.aabb(o); return bb.x >= r.x0 && bb.y >= r.y0 && bb.x1 <= r.x1 && bb.y1 <= r.y1; });
    P.select(hits.map((o) => o.id), { add: d.shift });
  }

  /* ---- creation tools ---- */
  function doCreatePreview(pt) {
    if (drag.tool === "text") return;
    doMarquee(pt);
  }
  function viewRectFrom(aScreen, bScreen) {
    const a = P.screenToWorld(aScreen), b = P.screenToWorld(bScreen);
    const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const d = P.rot({ x: b.x - a.x, y: b.y - a.y }, -S.cam.r);
    return { c, w: Math.abs(d.x), h: Math.abs(d.y) };
  }
  function finishCreate(d, pt) {
    $("#marquee").hidden = true;
    const z = S.cam.z;
    if (d.tool === "text") { createText(P.screenToWorld(pt)); return P.setTool("select"); }
    let rect;
    if (d.moved) rect = viewRectFrom(d.start, pt);
    else {
      const c = P.screenToWorld(pt);
      rect = d.tool === "frame" ? { c, w: (P.vw() * 0.42) / z, h: (P.vw() * 0.42 * 9) / 16 / z } : { c, w: 180 / z, h: 180 / z };
    }
    if (d.tool === "shape" && (d.shift || !d.moved) && S.shapeKind !== "line") rect.w = rect.h = Math.max(rect.w, rect.h);
    if (d.tool === "shape" && S.shapeKind === "line") rect.h = Math.max(4 / z, Math.min(rect.h, 6 / z));
    if (rect.w * z < 6 || rect.h * z < 3) return P.setTool("select");
    P.checkpoint();
    let o;
    if (d.tool === "frame") {
      const n = P.frames().length + 1;
      o = { id: P.uid("frame"), title: "Frame " + n, position: { x: rect.c.x - rect.w / 2, y: rect.c.y - rect.h / 2 }, width: rect.w, height: rect.h, rotation: S.cam.r, children_ids: [], content_blocks: [], style: "rect", fill_token: "surface", notes: "" };
      S.project.frames.push(o);
      S.project.presentation_path.push({ frame_id: o.id, transition_duration_ms: 1100, transition: "zoom" });
      P.toast(`Added to the path as step ${S.project.presentation_path.length}`, "path");
    } else {
      o = newElement("shape", rect.c, rect.w, rect.h);
      o.shape = S.shapeKind;
      o.fill_token = S.shapeKind === "line" ? "none" : "accent";
      o.stroke_token = S.shapeKind === "line" ? "accent" : "none";
      S.project.elements.push(o);
    }
    P.changed();
    P.select(o.id);
    P.setTool("select");
  }
  function newElement(kind, c, w, hgt) {
    return { id: P.uid(kind), kind, position: { x: c.x - w / 2, y: c.y - hgt / 2 }, width: w, height: hgt, rotation: S.cam.r, text: "", text_role: "body", font_size: 0, align: "left", bold: false, italic: false, color_token: "text", shape: "", fill_token: "", stroke_token: "", src: "", opacity: null, reveal_step: null, notes: "" };
  }
  function createText(world, text = "") {
    P.checkpoint();
    const z = S.cam.z;
    const size = Math.round((26 / z) * 100) / 100;
    const o = newElement("text", world, 460 / z, size * 1.3);
    o.font_size = size;
    o.text = text;
    o.position.y = world.y - (size * 1.3) / 2;
    o.position.x = world.x - 20 / z;
    S.project.elements.push(o);
    P.render();
    P.select(o.id);
    if (!text) startEditing(o.id, true);
    else P.changed();
    return o;
  }
  P.createText = createText;

  /* ---- inline text editing ---- */
  function startEditing(id, fresh = false) {
    const o = P.get(id), n = P.node(id);
    if (!o || !n) return;
    if (!fresh) P.checkpoint();
    editingId = id;
    n.classList.add("editing");
    n.contentEditable = "plaintext-only";
    if (n.contentEditable !== "plaintext-only") n.contentEditable = "true";
    n.focus();
    const range = document.createRange();
    range.selectNodeContents(n);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    P.select(id);
    P.requestOverlay();
  }
  P.startEditing = startEditing;
  function finishEditing() {
    if (!editingId) return;
    const id = editingId, n = P.node(id), o = P.get(id);
    editingId = null;
    if (n) { n.contentEditable = "false"; n.classList.remove("editing"); n.blur(); }
    if (o) {
      o.text = (n ? n.innerText : o.text).replace(/\n$/, "");
      if (!o.text.trim()) { S.project.elements = S.project.elements.filter((e) => e.id !== id); S.selection.delete(id); }
    }
    window.getSelection().removeAllRanges();
    P.changed();
    P.emit("selection");
  }
  P.finishEditing = finishEditing;
  $("#elements-layer").addEventListener("input", (e) => {
    const id = e.target.dataset && e.target.dataset.id;
    const o = id && P.get(id);
    if (o) { o.height = e.target.offsetHeight; P.requestOverlay(); }
  });
  $("#elements-layer").addEventListener("keydown", (e) => {
    if (!editingId) return;
    if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) { e.preventDefault(); finishEditing(); }
    e.stopPropagation();
  });
  $("#elements-layer").addEventListener("focusout", (e) => { if (editingId && e.target.dataset.id === editingId) setTimeout(() => editingId && document.activeElement !== P.node(editingId) && finishEditing(), 0); });

  /* ================= Object operations ================= */
  function duplicateObjects(objs, offset = 24 / S.cam.z) {
    const all = new Map();
    objs.forEach((o) => { all.set(o.id, o); if (P.isFrame(o)) P.childrenOf(o).forEach((k) => all.set(k.id, k)); });
    const clones = [];
    const top = new Set(objs.map((o) => o.id));
    all.forEach((o) => {
      const c = JSON.parse(JSON.stringify(o));
      c.id = P.uid(P.isFrame(o) ? "frame" : o.kind);
      c.position.x += offset; c.position.y += offset;
      if (P.isFrame(c)) { c.children_ids = []; c.title = c.title + " copy"; S.project.frames.push(c); } else S.project.elements.push(c);
      if (top.has(o.id)) clones.push(c);
    });
    return clones;
  }
  P.duplicate = () => {
    const sel = P.selected();
    if (!sel.length) return;
    P.checkpoint();
    const clones = duplicateObjects(sel);
    P.changed();
    P.select(clones.map((c) => c.id));
  };
  P.deleteSelection = () => {
    const ids = new Set(S.selection);
    if (!ids.size) return;
    P.checkpoint();
    S.project.frames = S.project.frames.filter((f) => !ids.has(f.id));
    S.project.elements = S.project.elements.filter((e) => !ids.has(e.id));
    S.project.frames.forEach((f) => (f.children_ids = f.children_ids.filter((c) => !ids.has(c))));
    S.project.presentation_path = S.project.presentation_path.filter((s) => !ids.has(s.frame_id));
    S.selection.clear();
    P.changed();
    P.emit("selection");
  };
  P.nudge = (dx, dy) => {
    const sel = P.selected();
    if (!sel.length) return;
    P.checkpoint();
    const d = P.rot({ x: dx / S.cam.z, y: dy / S.cam.z }, S.cam.r);
    const set = new Map();
    sel.forEach((o) => { set.set(o.id, o); if (P.isFrame(o)) P.childrenOf(o).forEach((k) => set.set(k.id, k)); });
    set.forEach((o) => { o.position.x += d.x; o.position.y += d.y; P.renderOne(o); });
    P.renderPathLine();
    P.changed({ structure: false });
    P.requestOverlay();
  };
  P.wrapInFrame = () => {
    const sel = P.selected();
    if (!sel.length) return;
    const b = P.boundsOf(sel), pad = Math.max(b.w, b.h) * 0.08;
    P.checkpoint();
    const f = { id: P.uid("frame"), title: "Group", position: { x: b.x - pad, y: b.y - pad }, width: b.w + pad * 2, height: b.h + pad * 2, rotation: 0, children_ids: [], content_blocks: [], style: "rect", fill_token: "surface", notes: "" };
    S.project.frames.push(f);
    S.project.presentation_path.push({ frame_id: f.id, transition_duration_ms: 1100, transition: "zoom" });
    P.changed();
    P.select(f.id);
    P.toast("Wrapped in a new frame and added to the path", "frame-corners");
  };
  P.reorder = (dir) => {
    const ids = S.selection;
    const els = S.project.elements;
    const picked = els.filter((e) => ids.has(e.id));
    if (!picked.length) return;
    P.checkpoint();
    const rest = els.filter((e) => !ids.has(e.id));
    S.project.elements = dir > 0 ? [...rest, ...picked] : [...picked, ...rest];
    P.changed();
  };
  P.align = (mode) => {
    const sel = P.selected();
    if (sel.length < 2) return;
    P.checkpoint();
    const b = P.boundsOf(sel);
    sel.forEach((o) => {
      const bb = P.aabb(o);
      if (mode === "left") o.position.x += b.x - bb.x;
      if (mode === "right") o.position.x += b.x1 - bb.x1;
      if (mode === "center") o.position.x += b.x + b.w / 2 - (bb.x + bb.w / 2);
      if (mode === "top") o.position.y += b.y - bb.y;
      if (mode === "bottom") o.position.y += b.y1 - bb.y1;
      if (mode === "middle") o.position.y += b.y + b.h / 2 - (bb.y + bb.h / 2);
    });
    if (mode === "dist-h" || mode === "dist-v") {
      const key = mode === "dist-h" ? "x" : "y", size = mode === "dist-h" ? "w" : "h";
      const items = sel.map((o) => ({ o, bb: P.aabb(o) })).sort((a, c) => a.bb[key] - c.bb[key]);
      const total = items.reduce((s, i) => s + i.bb[size], 0);
      const gap = (b[size] - total) / (items.length - 1);
      let cur = b[key];
      items.forEach((i) => { i.o.position[key] += cur - i.bb[key]; cur += i.bb[size] + gap; });
    }
    P.changed();
  };

  /* ================= Images ================= */
  P.readImageFile = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const url = reader.result;
      if (/svg|gif/.test(file.type) || file.size < 400 * 1024) {
        const img = new Image();
        img.onload = () => resolve({ src: url, w: img.naturalWidth || 800, h: img.naturalHeight || 600 });
        img.onerror = reject;
        img.src = url;
        return;
      }
      const img = new Image();
      img.onload = () => {
        const max = 2200, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        let out = c.toDataURL("image/webp", 0.86);
        if (!out.startsWith("data:image/webp")) out = c.toDataURL("image/jpeg", 0.86);
        resolve({ src: out, w: c.width, h: c.height });
      };
      img.onerror = reject;
      img.src = url;
    };
    reader.readAsDataURL(file);
  });
  P.insertImage = async (file, world) => {
    try {
      const { src, w, h: ih } = await P.readImageFile(file);
      const c = world || P.screenToWorld({ x: P.vw() / 2, y: P.vh() / 2 });
      const width = (P.vw() * 0.36) / S.cam.z, height = (width * ih) / w;
      P.checkpoint();
      const o = newElement("image", c, width, height);
      o.src = src;
      S.project.elements.push(o);
      P.changed();
      P.select(o.id);
    } catch (_) { P.toast("That image could not be read", "image"); }
  };
  $("#file-image").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (replaceTarget) {
      const t = replaceTarget; replaceTarget = null;
      P.readImageFile(f).then(({ src, w, h: ih }) => { P.checkpoint(); t.src = src; t.height = (t.width * ih) / w; P.changed(); P.emit("selection"); });
    } else P.insertImage(f);
    e.target.value = "";
  });
  let replaceTarget = null;
  stage.addEventListener("dragover", (e) => { if (S.mode === "edit") e.preventDefault(); });
  stage.addEventListener("drop", (e) => {
    if (S.mode !== "edit") return;
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
    const w = P.screenToWorld(local(e));
    files.forEach((f, i) => P.insertImage(f, { x: w.x + (i * 40) / S.cam.z, y: w.y + (i * 40) / S.cam.z }));
  });

  /* ================= Clipboard ================= */
  let clip = null;
  const copySel = () => {
    const sel = P.selected();
    if (!sel.length) return false;
    const all = new Map();
    sel.forEach((o) => { all.set(o.id, o); if (P.isFrame(o)) P.childrenOf(o).forEach((k) => all.set(k.id, k)); });
    clip = JSON.stringify([...all.values()]);
    try { navigator.clipboard && navigator.clipboard.writeText("prezi-rs:" + clip); } catch (_) {}
    return true;
  };
  const pasteObjects = (json) => {
    let objs;
    try { objs = JSON.parse(json); } catch (_) { return; }
    P.checkpoint();
    const off = 32 / S.cam.z;
    const ids = [];
    objs.forEach((o) => {
      o.id = P.uid(P.isFrame(o) ? "frame" : o.kind);
      o.position.x += off; o.position.y += off;
      if (P.isFrame(o)) S.project.frames.push(o); else S.project.elements.push(o);
      ids.push(o.id);
    });
    clip = JSON.stringify(objs);
    P.changed();
    P.select(ids);
  };
  document.addEventListener("copy", (e) => { if (S.mode === "edit" && !isTyping(e.target) && copySel()) { e.clipboardData.setData("text/plain", "prezi-rs:" + clip); e.preventDefault(); } });
  document.addEventListener("cut", (e) => { if (S.mode === "edit" && !isTyping(e.target) && copySel()) { e.clipboardData.setData("text/plain", "prezi-rs:" + clip); e.preventDefault(); P.deleteSelection(); } });
  document.addEventListener("paste", (e) => {
    if (S.mode !== "edit" || isTyping(e.target)) return;
    const items = [...(e.clipboardData ? e.clipboardData.items : [])];
    const img = items.find((i) => i.type.startsWith("image/"));
    if (img) { e.preventDefault(); return P.insertImage(img.getAsFile()); }
    const text = e.clipboardData && e.clipboardData.getData("text/plain");
    if (text && text.startsWith("prezi-rs:")) { e.preventDefault(); return pasteObjects(text.slice(9)); }
    if (text && text.trim()) {
      e.preventDefault();
      if (text.split("\n").filter((l) => l.trim()).length > 3) { P.run("outline", text); return; }
      createText(P.screenToWorld({ x: P.vw() / 2, y: P.vh() / 2 }), text.trim());
    } else if (clip) pasteObjects(clip);
  });

  /* ================= Tools ================= */
  P.setTool = (t) => {
    S.tool = t;
    $$("#dock .tool[data-tool]").forEach((b) => b.classList.toggle("active", b.dataset.tool === t));
    stage.className = "tool-" + t;
  };
  $("#dock").addEventListener("click", (e) => {
    const caret = e.target.closest("#shape-caret");
    if (caret) { e.stopPropagation(); return openShapePicker(caret.closest(".tool")); }
    const b = e.target.closest("[data-tool]");
    if (b) P.setTool(b.dataset.tool);
  });
  function openShapePicker(anchor) {
    const pop = h("div", { class: "pop", style: "min-width:0;display:grid;grid-template-columns:repeat(4,40px);gap:2px" });
    P.SHAPE_KINDS.forEach((k) => {
      const b = h("button", { class: "tool" + (S.shapeKind === k.id ? " active" : ""), "aria-label": k.label, "data-tip": k.label }, icon(k.icon));
      b.onclick = () => { S.shapeKind = k.id; $("#shape-tool-icon").outerHTML = icon(k.icon, "").replace('class="ico ', 'id="shape-tool-icon" class="ico '); P.setTool("shape"); closePopovers(); };
      pop.appendChild(b);
    });
    openPopover(anchor, pop, { side: "top", align: "center" });
  }

  /* ================= Popovers ================= */
  let openPop = null;
  function openPopover(anchor, node, { side = "bottom", align = "start" } = {}) {
    closePopovers();
    $("#popover-layer").appendChild(node);
    const r = anchor.getBoundingClientRect(), pw = node.offsetWidth, ph = node.offsetHeight;
    let x = align === "end" ? r.right - pw : align === "center" ? r.left + r.width / 2 - pw / 2 : r.left;
    let y = side === "top" ? r.top - ph - 8 : r.bottom + 8;
    x = P.clamp(x, 8, window.innerWidth - pw - 8);
    y = P.clamp(y, 8, window.innerHeight - ph - 8);
    node.style.left = x + "px";
    node.style.top = y + "px";
    node.style.setProperty("--origin", `${side === "top" ? "bottom" : "top"} ${align === "end" ? "right" : align === "center" ? "center" : "left"}`);
    openPop = { node, anchor };
    P.hydrateIcons(node);
    return node;
  }
  function closePopovers() {
    if (openPop) { openPop.node.remove(); openPop = null; }
  }
  P.openPopover = openPopover;
  P.closePopovers = closePopovers;
  document.addEventListener("pointerdown", (e) => {
    if (openPop && !openPop.node.contains(e.target) && !openPop.anchor.contains(e.target)) closePopovers();
  }, true);

  const menuItem = (ic, title, desc, onClick, cls = "") => {
    const b = h("button", { class: "menu-item " + cls, role: "menuitem" }, `${ic ? icon(ic) : ""}<span class="grow"><span class="t">${esc(title)}</span>${desc ? `<span class="d">${esc(desc)}</span>` : ""}</span>`);
    b.onclick = onClick;
    return b;
  };

  /* ---- Deck menu ---- */
  const ago = (ts) => {
    const s = Math.max(1, Math.floor(Date.now() / 1000 - ts));
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    return Math.floor(s / 86400) + " d ago";
  };
  async function openDeckMenu() {
    const btn = $("#btn-decks");
    const pop = h("div", { class: "pop", role: "menu", style: "width:320px" });
    pop.appendChild(h("div", { class: "menu-label" }, "Your decks"));
    const list = h("div", { class: "deck-list" }, `<div class="menu-label">Loading</div>`);
    pop.appendChild(list);
    pop.appendChild(h("div", { class: "menu-sep" }));
    pop.appendChild(menuItem("file-plus", "New blank deck", "", () => newDeck({ template: "blank" })));
    pop.appendChild(menuItem("magic-wand", "New deck from outline", "Paste notes, get a layout", () => { closePopovers(); P.run("outline", { fresh: true }); }));
    pop.appendChild(menuItem("sparkle", "Starter tour", "A guided example deck", () => newDeck({ template: "starter" })));
    pop.appendChild(menuItem("stack", "50-frame benchmark", "Stress-test the camera", () => newDeck({ template: "benchmark" })));
    pop.appendChild(h("div", { class: "menu-sep" }));
    pop.appendChild(menuItem("upload-simple", "Import .prezi-rs file", "", () => { closePopovers(); $("#file-import").click(); }));
    pop.appendChild(menuItem("copy", "Duplicate this deck", "", async () => { closePopovers(); await P.flush(); loadProject(await P.api(`/api/projects/${S.project.id}/duplicate`, { method: "POST" })); P.toast("Deck duplicated", "copy"); }));
    const del = menuItem("trash", "Delete this deck", "", async () => {
      if (!del.classList.contains("armed")) { del.classList.add("armed"); del.querySelector(".t").textContent = "Click again to delete"; return; }
      closePopovers();
      loadProject(await P.api(`/api/projects/${S.project.id}`, { method: "DELETE" }));
      P.toast("Deck deleted", "trash");
    }, "danger");
    pop.appendChild(del);
    openPopover(btn, pop);
    try {
      const decks = await P.api("/api/projects");
      list.innerHTML = "";
      decks.forEach((d) => {
        const it = menuItem(d.active ? "check" : "presentation", d.name || "Untitled", `${d.step_count} steps, edited ${ago(d.updated_at)}`, async () => {
          closePopovers();
          if (d.active) return;
          await P.flush();
          loadProject(await P.api(`/api/projects/${d.id}/open`, { method: "POST" }));
        });
        if (d.active) it.querySelector("svg").classList.add("check");
        list.appendChild(it);
      });
    } catch (_) { list.innerHTML = `<div class="menu-label">Could not reach the local server</div>`; }
  }
  async function newDeck(body) {
    closePopovers();
    await P.flush();
    try {
      loadProject(await P.api("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
      if (body.template === "blank") setTimeout(() => { $("#deck-title").focus(); $("#deck-title").select(); }, 50);
    } catch (e) { P.toast("Could not create the deck", "x"); }
  }
  P.newDeck = newDeck;
  function loadProject(p) {
    S.project = p;
    P.markSaved();
    S.history = []; S.future = [];
    S.selection.clear();
    S.step = -1;
    P.applyTheme(p.theme_id);
    P.render();
    P.fitAll(false);
    if (p.presentation_path.length) { const cam = P.stepCamera(0); if (cam) P.setCamera(P.cameraFor(P.get(p.presentation_path[0].frame_id))); }
    P.emit("selection");
    P.emit("project", { structure: true });
  }
  P.loadProject = loadProject;
  $("#btn-decks").addEventListener("click", openDeckMenu);
  $("#file-import").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      await P.flush();
      loadProject(await P.api("/api/project/import", { method: "POST", body: await f.arrayBuffer() }));
      P.toast(`Imported "${S.project.name}"`, "upload-simple");
    } catch (_) { P.toast("That file is not a valid .prezi-rs bundle", "x"); }
  });

  /* ---- Deck title ---- */
  const titleInput = $("#deck-title");
  titleInput.addEventListener("change", () => { P.checkpoint(); S.project.name = titleInput.value.trim() || "Untitled deck"; titleInput.value = S.project.name; P.changed({ structure: false }); });
  titleInput.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); titleInput.blur(); } e.stopPropagation(); });

  /* ---- Export menu ---- */
  $("#btn-export").addEventListener("click", (e) => {
    const pop = h("div", { class: "pop", role: "menu", style: "width:300px" });
    const dl = async (url) => { closePopovers(); await P.flush(); const a = h("a", { href: url, download: "" }); document.body.appendChild(a); a.click(); a.remove(); };
    pop.appendChild(menuItem("file-html", "Offline HTML player", "One file. Plays in any browser, no server.", () => dl("/api/project/export-html").then(() => P.toast("Exporting the HTML player", "file-html"))));
    pop.appendChild(menuItem("file-zip", ".prezi-rs bundle", "Editable archive you can import later", () => dl("/api/project/export").then(() => P.toast("Exporting the bundle", "file-zip"))));
    pop.appendChild(h("div", { class: "menu-sep" }));
    pop.appendChild(menuItem("upload-simple", "Import .prezi-rs file", "", () => { closePopovers(); $("#file-import").click(); }));
    openPopover(e.currentTarget, pop, { align: "end" });
  });

  /* ---- Theme panel ---- */
  const CAT_LABEL = { Minimalist: "Minimal", DarkTerminal: "Terminal", Academic: "Academic", VibrantModern: "Vibrant", Monochrome: "Mono", EarthWarm: "Earth", Cyberpunk: "Neon", Corporate: "Business" };
  let themeFilter = { q: "", cat: "all", mode: "all" };
  $("#btn-theme").addEventListener("click", (e) => {
    const pop = h("div", { class: "pop theme-pop", role: "dialog", "aria-label": "Themes" });
    const head = h("div", { class: "head" });
    const search = h("input", { class: "input", placeholder: "Search 100 themes", "aria-label": "Search themes", value: themeFilter.q });
    const chips = h("div", { class: "chips" });
    const cats = [["all", "All"], ["dark", "Dark"], ["light", "Light"], ...Object.entries(CAT_LABEL)];
    const grid = h("div", { class: "theme-grid" });
    const renderGrid = () => {
      const q = themeFilter.q.toLowerCase();
      const list = S.themes.filter((t) =>
        (!q || t.name.toLowerCase().includes(q)) &&
        (themeFilter.cat === "all" || (themeFilter.cat === "dark" ? t.is_dark : themeFilter.cat === "light" ? !t.is_dark : t.category === themeFilter.cat)));
      grid.innerHTML = list.length ? "" : `<div class="hint" style="grid-column:1/-1;padding:20px;text-align:center">No themes match</div>`;
      list.forEach((t) => {
        const card = h("button", { class: "theme-card" + (t.id === S.project.theme_id ? " on" : ""), "aria-label": t.name, "aria-pressed": t.id === S.project.theme_id });
        card.innerHTML = `<span class="sw" style="background:${t.background}"><span class="card" style="background:${t.surface};box-shadow:0 0 0 1px ${t.frame_border}"><span class="aa" style="color:${t.text_primary};font-family:${esc(t.display_font)}">Aa</span><span class="bar" style="background:${t.primary_accent}"></span></span><span class="dot" style="background:${t.secondary_accent}"></span></span><span class="nm">${esc(t.name)}</span>`;
        card.onmouseenter = () => P.applyTheme(t.id);
        card.onfocus = () => P.applyTheme(t.id);
        card.onclick = () => {
          P.checkpoint();
          S.project.theme_id = t.id;
          P.applyTheme(t.id);
          P.changed({ structure: false });
          $$(".theme-card", grid).forEach((c) => c.classList.remove("on"));
          card.classList.add("on");
        };
        grid.appendChild(card);
      });
    };
    cats.forEach(([id, label]) => {
      const c = h("button", { class: "chip" + (themeFilter.cat === id ? " on" : "") }, esc(label));
      c.onclick = () => { themeFilter.cat = id; $$(".chip", chips).forEach((x) => x.classList.remove("on")); c.classList.add("on"); renderGrid(); };
      chips.appendChild(c);
    });
    search.oninput = () => { themeFilter.q = search.value; renderGrid(); };
    search.onkeydown = (ev) => ev.stopPropagation();
    grid.onmouseleave = () => P.applyTheme(S.project.theme_id);
    head.append(search, chips);
    pop.append(head, grid);
    renderGrid();
    openPopover(e.currentTarget, pop, { align: "end" });
    const on = grid.querySelector(".on");
    if (on) on.scrollIntoView({ block: "center" });
    search.focus();
  });
  P.on("theme", () => { scheduleThumbs(); drawMinimap(true); });

  /* ================= Inspector ================= */
  const insp = $("#inspector");
  let inspLock = false;
  function renderInspector() {
    if (inspLock) return;
    const sel = P.selected();
    if (!sel.length || S.mode !== "edit") { insp.hidden = true; return; }
    insp.hidden = false;
    insp.innerHTML = "";
    const head = h("div", { class: "insp-head" });
    const o = sel[0];
    const kindName = sel.length > 1 ? `${sel.length} selected` : P.isFrame(o) ? "Frame" : o.kind[0].toUpperCase() + o.kind.slice(1);
    const kindIcon = sel.length > 1 ? "selection-all" : P.isFrame(o) ? "frame-corners" : { text: "text-t", shape: "shapes", image: "image" }[o.kind];
    head.innerHTML = `<div class="kind">${icon(kindIcon)}<span>${esc(kindName)}</span></div>`;
    const dup = h("button", { class: "icon-btn sm", "aria-label": "Duplicate", "data-tip": "Duplicate", "data-kbd": "⌘D" }, icon("copy"));
    dup.onclick = P.duplicate;
    const del = h("button", { class: "icon-btn sm", "aria-label": "Delete", "data-tip": "Delete", "data-kbd": "⌫" }, icon("trash"));
    del.onclick = P.deleteSelection;
    const close = h("button", { class: "icon-btn sm", "aria-label": "Close inspector", "data-tip": "Deselect", "data-kbd": "Esc" }, icon("x"));
    close.onclick = P.clearSelection;
    head.append(dup, del, close);
    insp.appendChild(head);

    if (sel.length > 1) return renderMulti(sel);
    if (P.isFrame(o)) renderFrameInsp(o);
    else if (o.kind === "text") renderTextInsp(o);
    else if (o.kind === "shape") renderShapeInsp(o);
    else renderImageInsp(o);
    renderPathSection(o);
    if (!P.isFrame(o)) renderRevealSection(o);
    renderGeometry(o);
  }
  const sec = (label) => { const s = h("div", { class: "insp-sec" }); if (label) s.appendChild(h("label", {}, esc(label))); insp.appendChild(s); return s; };
  /** Live edit: mutate, re-render node, autosave, without rebuilding the inspector. */
  const live = (o, fn, { structure = false } = {}) => {
    fn(o);
    P.renderOne(o);
    if (structure) { inspLock = true; P.render(); inspLock = false; }
    P.renderPathLine();
    P.requestOverlay();
    P.emit("project", { structure: false });
    P.scheduleSave();
  };
  const once = (o) => { if (!o.__cp) { P.checkpoint(); o.__cp = true; setTimeout(() => delete o.__cp, 900); } };
  function seg(items, current, onPick) {
    const s = h("div", { class: "seg", role: "radiogroup" });
    items.forEach((it) => {
      const b = h("button", { class: it.id === current ? "on" : "", role: "radio", "aria-checked": it.id === current, "aria-label": it.label, "data-tip": it.icon ? it.label : null }, it.icon ? icon(it.icon) : esc(it.label));
      b.onclick = () => { $$("button", s).forEach((x) => { x.classList.remove("on"); x.setAttribute("aria-checked", "false"); }); b.classList.add("on"); b.setAttribute("aria-checked", "true"); onPick(it.id); };
      s.appendChild(b);
    });
    return s;
  }
  function swatches(tokens, current, onPick, cssFor = (t) => P.tokenCss(t)) {
    const s = h("div", { class: "swatches", role: "radiogroup" });
    tokens.forEach((t) => {
      const label = (P.TOKENS.find((x) => x.id === t) || { label: t === "none" ? "None" : t }).label;
      const b = h("button", { class: "swatch" + (t === "none" ? " none" : "") + (t === current ? " on" : ""), role: "radio", "aria-checked": t === current, "aria-label": label, "data-tip": label });
      if (t !== "none") b.style.background = cssFor(t);
      b.onclick = () => { $$(".swatch", s).forEach((x) => x.classList.remove("on")); b.classList.add("on"); onPick(t); };
      s.appendChild(b);
    });
    return s;
  }
  function renderFrameInsp(f) {
    const s = sec("Title");
    const ti = h("input", { class: "input", value: f.title, "aria-label": "Frame title" });
    ti.oninput = () => { once(f); live(f, (x) => (x.title = ti.value)); scheduleThumbs(); };
    s.appendChild(ti);
    const st = sec("Style");
    st.appendChild(seg([{ id: "rect", icon: "square", label: "Rectangle" }, { id: "circle", icon: "circle", label: "Circle" }, { id: "bracket", icon: "frame-corners", label: "Bracket" }, { id: "invisible", icon: "eye-slash", label: "Invisible" }], f.style, (v) => { P.checkpoint(); live(f, (x) => (x.style = v)); scheduleThumbs(); }));
    const fl = sec("Fill");
    fl.appendChild(swatches(["surface", "bg", "accent", "accent2", "none"], f.fill_token || "surface", (v) => { P.checkpoint(); live(f, (x) => (x.fill_token = v)); scheduleThumbs(); }, P.frameFillCss));
    const n = sec("Speaker notes");
    const ta = h("textarea", { class: "input", placeholder: "What you want to say here. Shown in presenter view.", "aria-label": "Speaker notes" });
    ta.value = f.notes || "";
    ta.oninput = () => { once(f); f.notes = ta.value; P.scheduleSave(); };
    n.appendChild(ta);
  }
  function renderTextInsp(e) {
    const r = sec("Role");
    r.appendChild(seg([{ id: "title", label: "Title" }, { id: "heading", label: "Heading" }, { id: "body", label: "Body" }, { id: "caption", label: "Caption" }], e.text_role, (v) => {
      P.checkpoint();
      const ratio = (e.font_size || P.ROLE_SIZE[e.text_role] || 28) / (P.ROLE_SIZE[e.text_role] || 28);
      live(e, (x) => { x.text_role = v; x.font_size = Math.round(P.ROLE_SIZE[v] * ratio * 100) / 100; x.bold = v === "title" || v === "heading"; x.color_token = v === "caption" ? "muted" : x.color_token === "muted" ? "text" : x.color_token; }, { structure: true });
      renderInspector();
    }));
    const t = sec("Type");
    const row = h("div", { class: "row" });
    const size = h("label", { class: "field", style: "flex:1" }, `<span>Aa</span>`);
    const si = h("input", { type: "number", min: "0.1", step: "1", value: +(e.font_size || P.ROLE_SIZE[e.text_role]).toFixed(2), "aria-label": "Font size" });
    si.oninput = () => { const v = parseFloat(si.value); if (v > 0) { once(e); live(e, (x) => (x.font_size = v)); } };
    size.appendChild(si);
    const b = h("button", { class: "icon-btn sm" + (e.bold ? " on" : ""), "aria-label": "Bold", "data-tip": "Bold", "aria-pressed": e.bold }, icon("text-b"));
    b.onclick = () => { P.checkpoint(); live(e, (x) => (x.bold = !x.bold)); b.classList.toggle("on", e.bold); };
    const it = h("button", { class: "icon-btn sm" + (e.italic ? " on" : ""), "aria-label": "Italic", "data-tip": "Italic", "aria-pressed": e.italic }, icon("text-italic"));
    it.onclick = () => { P.checkpoint(); live(e, (x) => (x.italic = !x.italic)); it.classList.toggle("on", e.italic); };
    row.append(size, b, it);
    t.appendChild(row);
    t.appendChild(seg([{ id: "left", icon: "text-align-left", label: "Align left" }, { id: "center", icon: "text-align-center", label: "Align center" }, { id: "right", icon: "text-align-right", label: "Align right" }], e.align || "left", (v) => { P.checkpoint(); live(e, (x) => (x.align = v)); }));
    const c = sec("Color");
    c.appendChild(swatches(["text", "muted", "accent", "accent2"], e.color_token || "text", (v) => { P.checkpoint(); live(e, (x) => (x.color_token = v)); scheduleThumbs(); }));
    const ed = h("button", { class: "btn btn-block" }, icon("pencil-simple") + "Edit text");
    ed.onclick = () => startEditing(e.id);
    c.appendChild(ed);
  }
  function renderShapeInsp(e) {
    const s = sec("Shape");
    const grid = h("div", { class: "seg", style: "flex-wrap:wrap" });
    P.SHAPE_KINDS.forEach((k) => {
      const b = h("button", { class: k.id === e.shape ? "on" : "", style: "flex:0 0 calc(25% - 2px)", "aria-label": k.label, "data-tip": k.label }, icon(k.icon));
      b.onclick = () => { P.checkpoint(); live(e, (x) => { x.shape = k.id; if (k.id === "line") { x.stroke_token = x.stroke_token && x.stroke_token !== "none" ? x.stroke_token : x.fill_token || "accent"; } }); $$("button", grid).forEach((y) => y.classList.remove("on")); b.classList.add("on"); scheduleThumbs(); };
      grid.appendChild(b);
    });
    s.appendChild(grid);
    if (e.shape !== "line") {
      const f = sec("Fill");
      f.appendChild(swatches(["accent", "accent2", "surface", "text", "muted", "none"], e.fill_token || "accent", (v) => { P.checkpoint(); live(e, (x) => (x.fill_token = v)); scheduleThumbs(); }));
    }
    const st = sec(e.shape === "line" ? "Color" : "Outline");
    st.appendChild(swatches(["none", "accent", "accent2", "text", "muted"].filter((t) => e.shape !== "line" || t !== "none"), e.stroke_token || "none", (v) => { P.checkpoint(); live(e, (x) => (x.stroke_token = v)); scheduleThumbs(); }));
    renderOpacity(e);
  }
  function renderImageInsp(e) {
    const s = sec("Image");
    const b = h("button", { class: "btn btn-block" }, icon("image") + "Replace image");
    b.onclick = () => { replaceTarget = e; $("#file-image").click(); };
    s.appendChild(b);
    renderOpacity(e);
  }
  function renderOpacity(e) {
    const s = sec("Opacity");
    const r = h("input", { type: "range", min: "0.05", max: "1", step: "0.05", value: e.opacity == null ? 1 : e.opacity, "aria-label": "Opacity" });
    r.oninput = () => { once(e); live(e, (x) => (x.opacity = parseFloat(r.value) >= 1 ? null : parseFloat(r.value))); };
    s.appendChild(r);
  }
  function renderPathSection(o) {
    const s = sec("Path");
    const idx = S.project.presentation_path.map((st, i) => (st.frame_id === o.id ? i + 1 : 0)).filter(Boolean);
    s.appendChild(h("div", { class: "hint" }, idx.length ? `Step ${idx.join(", ")} of ${S.project.presentation_path.length}` : "Not in the path yet. The camera will not stop here."));
    const row = h("div", { class: "row" });
    const add = h("button", { class: "btn", style: "flex:1" }, icon("plus") + (idx.length ? "Add again" : "Add to path"));
    add.onclick = () => { P.addSteps([o.id]); renderInspector(); };
    row.appendChild(add);
    if (idx.length) {
      const rm = h("button", { class: "btn", style: "flex:1" }, icon("minus") + "Remove");
      rm.onclick = () => { P.checkpoint(); S.project.presentation_path = S.project.presentation_path.filter((st) => st.frame_id !== o.id); P.changed(); renderInspector(); };
      row.appendChild(rm);
    }
    s.appendChild(row);
  }
  function renderRevealSection(e) {
    const s = sec("Reveal");
    const sel = h("select", { class: "input", "aria-label": "Reveal on step" });
    sel.innerHTML = `<option value="">Always visible</option>` + S.project.presentation_path.map((st, i) => `<option value="${i}" ${e.reveal_step === i ? "selected" : ""}>Appear at step ${i + 1}: ${esc(P.objTitle(P.get(st.frame_id)))}</option>`).join("");
    sel.onchange = () => { P.checkpoint(); live(e, (x) => (x.reveal_step = sel.value === "" ? null : parseInt(sel.value, 10))); scheduleThumbs(); };
    s.appendChild(sel);
    s.appendChild(h("div", { class: "hint" }, "Fades in while presenting, when the path reaches that step."));
  }
  function renderGeometry(o) {
    const s = sec("Position");
    const g = h("div", { class: "grid2" });
    const mk = (lab, get, set) => {
      const f = h("label", { class: "field" }, `<span>${lab}</span>`);
      const i = h("input", { type: "number", step: "1", value: Math.round(get() * 100) / 100, "aria-label": lab });
      i.onchange = () => { const v = parseFloat(i.value); if (!isNaN(v)) { P.checkpoint(); live(o, () => set(v), { structure: true }); } };
      i.onkeydown = (ev) => ev.stopPropagation();
      f.appendChild(i);
      g.appendChild(f);
    };
    mk("X", () => o.position.x, (v) => (o.position.x = v));
    mk("Y", () => o.position.y, (v) => (o.position.y = v));
    mk("W", () => o.width, (v) => (o.width = Math.max(1, v)));
    if (P.isFrame(o) || o.kind !== "text") mk("H", () => o.height, (v) => (o.height = Math.max(1, v)));
    mk("°", () => ((o.rotation || 0) * 180) / Math.PI, (v) => (o.rotation = (v * Math.PI) / 180));
    s.appendChild(g);
  }
  function renderMulti(sel) {
    const s = sec("Align");
    const g = h("div", { class: "seg", style: "flex-wrap:wrap" });
    [["left", "Left"], ["center", "Center"], ["right", "Right"], ["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"]].forEach(([id, l]) => {
      const b = h("button", { style: "flex:0 0 calc(33.3% - 2px)" }, l);
      b.onclick = () => P.align(id);
      g.appendChild(b);
    });
    s.appendChild(g);
    if (sel.length > 2) {
      const d = h("div", { class: "seg" });
      [["dist-h", "Space horizontally"], ["dist-v", "Space vertically"]].forEach(([id, l]) => { const b = h("button", {}, l); b.onclick = () => P.align(id); d.appendChild(b); });
      s.appendChild(d);
    }
    const a = sec("Group");
    const w = h("button", { class: "btn btn-block" }, icon("frame-corners") + "Wrap in frame");
    w.onclick = P.wrapInFrame;
    const p = h("button", { class: "btn btn-block" }, icon("path") + "Add all to path");
    p.onclick = () => P.addSteps(sel.map((o) => o.id));
    a.append(w, p);
  }
  P.on("selection", () => { renderInspector(); P.requestOverlay(); });
  P.on("project", (o) => { if (o && o.structure) renderInspector(); });

  /* ================= Path rail ================= */
  P.addSteps = (ids) => {
    if (!ids.length) return;
    P.checkpoint();
    const at = S.step >= 0 ? S.step + 1 : S.project.presentation_path.length;
    S.project.presentation_path.splice(at, 0, ...ids.map((id) => ({ frame_id: id, transition_duration_ms: 1100, transition: "zoom" })));
    S.step = at + ids.length - 1;
    P.changed();
    P.toast(ids.length > 1 ? `Added ${ids.length} steps` : `Added as step ${at + 1}`, "path");
  };
  /** Adds the selection to the path, or freezes the current view as an invisible frame. */
  P.addStepFromView = () => {
    const sel = P.selected();
    if (sel.length) return P.addSteps(sel.map((o) => o.id));
    P.checkpoint();
    const W = P.vw(), H = P.vh(), z = S.cam.z;
    const w = W / z, hh = H / z;
    const f = { id: P.uid("view"), title: "View " + (S.project.presentation_path.length + 1), position: { x: S.cam.x - w / 2, y: S.cam.y - hh / 2 }, width: w, height: hh, rotation: S.cam.r, children_ids: [], content_blocks: [], style: "invisible", fill_token: "none", notes: "" };
    S.project.frames.push(f);
    S.history.pop();
    P.addSteps([f.id]);
  };
  const list = $("#path-list");
  function renderPath() {
    const steps = S.project.presentation_path;
    $("#path-count").textContent = steps.length;
    list.innerHTML = "";
    if (!steps.length) {
      list.innerHTML = `<li class="rail-empty"><b>No steps yet.</b><br>Select something and press <kbd>⇧A</kbd>, or add the current view with the plus button.</li>`;
      return;
    }
    steps.forEach((st, i) => {
      const o = P.get(st.frame_id);
      const li = h("li", { class: "step" + (i === S.step ? " current" : ""), "data-i": i, tabindex: "0", "aria-label": `Step ${i + 1}: ${P.objTitle(o)}` });
      const trans = st.transition === "fade" ? "Fade" : st.transition === "cut" ? "Cut" : (st.transition_duration_ms / 1000).toFixed(1) + "s";
      li.innerHTML = `<span class="step-num">${i + 1}</span><div class="step-body"><canvas></canvas><div class="step-meta"><span class="step-title">${esc(P.objTitle(o))}</span><span class="step-trans">${trans}</span><button class="step-more" aria-label="Step options">${icon("dots-six-vertical")}</button></div></div>`;
      list.appendChild(li);
    });
    scheduleThumbs(true);
  }
  let thumbTimer = 0;
  function scheduleThumbs(now) {
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(drawThumbs, now ? 0 : 260);
  }
  P.scheduleThumbs = scheduleThumbs;
  function drawThumbs() {
    $$("canvas", list).forEach((c, i) => P.drawStepThumb(c, i, { revealAll: true }));
  }
  P.goToStepEdit = (i) => {
    const steps = S.project.presentation_path;
    if (!steps.length) return;
    i = P.clamp(i, 0, steps.length - 1);
    S.step = i;
    const o = P.get(steps[i].frame_id);
    $$(".step", list).forEach((n) => n.classList.toggle("current", +n.dataset.i === i));
    const cur = list.querySelector(".step.current");
    if (cur) cur.scrollIntoView({ block: "nearest", behavior: P.reducedMotion() ? "auto" : "smooth" });
    if (o) P.flyTo(P.cameraFor(o), { duration: 850 });
  };
  // Click to visit, drag to reorder.
  let railDrag = null;
  list.addEventListener("pointerdown", (e) => {
    const li = e.target.closest(".step");
    if (!li || e.button !== 0) return;
    if (e.target.closest(".step-more")) return;
    railDrag = { li, i: +li.dataset.i, y: e.clientY, moved: false, id: e.pointerId };
  });
  list.addEventListener("pointermove", (e) => {
    if (!railDrag) return;
    if (!railDrag.moved && Math.abs(e.clientY - railDrag.y) < 5) return;
    if (!railDrag.moved) { railDrag.moved = true; railDrag.li.classList.add("dragging"); list.setPointerCapture(railDrag.id); }
    $$(".step", list).forEach((n) => n.classList.remove("drop-before", "drop-after"));
    const items = $$(".step", list);
    let target = items.length, before = true;
    for (let k = 0; k < items.length; k++) {
      const r = items[k].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { target = k; break; }
    }
    if (target === items.length) { before = false; items[items.length - 1].classList.add("drop-after"); } else items[target].classList.add("drop-before");
    railDrag.to = before ? target : items.length;
  });
  list.addEventListener("pointerup", (e) => {
    const d = railDrag;
    railDrag = null;
    if (!d) return;
    $$(".step", list).forEach((n) => n.classList.remove("drop-before", "drop-after", "dragging"));
    if (!d.moved) return P.goToStepEdit(d.i);
    let to = d.to == null ? d.i : d.to;
    if (to > d.i) to -= 1;
    if (to === d.i) return;
    P.checkpoint();
    const [st] = S.project.presentation_path.splice(d.i, 1);
    S.project.presentation_path.splice(to, 0, st);
    // Keep reveal steps pointing at the same moments after reordering.
    const remap = (k) => (k === d.i ? to : d.i < to ? (k > d.i && k <= to ? k - 1 : k) : k >= to && k < d.i ? k + 1 : k);
    S.project.elements.forEach((el) => { if (el.reveal_step != null) el.reveal_step = remap(el.reveal_step); });
    S.step = to;
    P.changed();
  });
  list.addEventListener("keydown", (e) => {
    const li = e.target.closest(".step");
    if (!li) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); P.goToStepEdit(+li.dataset.i); }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); e.stopPropagation(); removeStep(+li.dataset.i); }
  });
  list.addEventListener("click", (e) => {
    const more = e.target.closest(".step-more");
    if (more) openStepMenu(more, +more.closest(".step").dataset.i);
  });
  function removeStep(i) {
    P.checkpoint();
    S.project.presentation_path.splice(i, 1);
    S.project.elements.forEach((el) => { if (el.reveal_step != null && el.reveal_step > i) el.reveal_step -= 1; else if (el.reveal_step === i) el.reveal_step = null; });
    if (S.step >= S.project.presentation_path.length) S.step = S.project.presentation_path.length - 1;
    P.changed();
  }
  function openStepMenu(anchor, i) {
    const st = S.project.presentation_path[i];
    const o = P.get(st.frame_id);
    const pop = h("div", { class: "pop", style: "width:260px;padding:10px;display:grid;gap:10px" });
    pop.appendChild(h("div", { class: "insp-label" }, `Step ${i + 1}: ${esc(P.objTitle(o))}`));
    pop.appendChild(seg([{ id: "zoom", label: "Fly" }, { id: "fade", label: "Fade" }, { id: "cut", label: "Cut" }], st.transition || "zoom", (v) => { P.checkpoint(); st.transition = v; P.changed(); }));
    const durRow = h("div", { class: "row" });
    const range = h("input", { type: "range", min: "300", max: "3000", step: "100", value: st.transition_duration_ms, "aria-label": "Duration" });
    const lab = h("span", { class: "step-trans", style: "width:36px;text-align:right" }, (st.transition_duration_ms / 1000).toFixed(1) + "s");
    range.oninput = () => { lab.textContent = (range.value / 1000).toFixed(1) + "s"; };
    range.onchange = () => { P.checkpoint(); st.transition_duration_ms = +range.value; P.changed(); };
    durRow.append(range, lab);
    pop.appendChild(durRow);
    const menu = h("div", {});
    menu.appendChild(menuItem("crosshair", "Select on canvas", "", () => { closePopovers(); if (o) { P.select(o.id); P.goToStepEdit(i); } }));
    if (o && P.isFrame(o)) menu.appendChild(menuItem("corners-out", "Reframe to current view", "Move this frame to what you see now", () => {
      closePopovers(); P.checkpoint();
      const W = P.vw(), H = P.vh(), z = S.cam.z;
      const ratio = o.width / o.height, vw = W / z, vh = H / z;
      const w = Math.min(vw, vh * ratio) * 0.86, hh = w / ratio;
      o.width = w; o.height = hh; o.rotation = S.cam.r; o.position.x = S.cam.x - w / 2; o.position.y = S.cam.y - hh / 2;
      P.changed();
    }));
    menu.appendChild(menuItem("monitor-play", "Present from here", "", () => { closePopovers(); P.present(i); }));
    menu.appendChild(menuItem("trash", "Remove step", "", () => { closePopovers(); removeStep(i); }, "danger"));
    pop.appendChild(menu);
    openPopover(anchor, pop, { align: "start" });
  }
  P.on("project", (o) => { if (!o || o.structure !== false) renderPath(); else scheduleThumbs(); });
  P.on("image-loaded", () => { scheduleThumbs(); drawMinimap(true); });

  /* ================= Minimap ================= */
  const mm = $("#minimap");
  let mmCache = null, mmCam = null;
  function drawMinimap(rebuild) {
    if (!S.project || S.mode !== "edit" || !S.showMinimap || mm.offsetParent === null) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = 220, H = 132;
    if (mm.width !== W * dpr) { mm.width = W * dpr; mm.height = H * dpr; }
    const b = P.boundsOf(P.allObjects()) || { x: -800, y: -450, w: 1600, h: 900 };
    if (rebuild || !mmCache) {
      const pad = Math.max(b.w, b.h) * 0.08;
      const bb = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
      const z = Math.min(W / bb.w, H / bb.h);
      mmCam = { x: bb.x + bb.w / 2, y: bb.y + bb.h / 2, z, r: 0 };
      mmCache = document.createElement("canvas");
      mmCache.width = W * dpr; mmCache.height = H * dpr;
      const cx = mmCache.getContext("2d");
      cx.scale(dpr, dpr);
      P.drawScene(cx, mmCam, W, H, { schematic: true, showInvisible: false });
    }
    const ctx = mm.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(mmCache, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const toMM = (p) => ({ x: (p.x - mmCam.x) * mmCam.z + W / 2, y: (p.y - mmCam.y) * mmCam.z + H / 2 });
    const vp = [{ x: 0, y: 0 }, { x: P.vw(), y: 0 }, { x: P.vw(), y: P.vh() }, { x: 0, y: P.vh() }].map((p) => toMM(P.screenToWorld(p)));
    ctx.beginPath();
    vp.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = "rgba(59,116,255,0.14)";
    ctx.fill();
    ctx.strokeStyle = "#3b74ff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  P.drawMinimap = drawMinimap;
  const mmNav = (e) => {
    if (!mmCam) return;
    const r = mm.getBoundingClientRect();
    const x = (e.clientX - r.left - 110) / mmCam.z + mmCam.x, y = (e.clientY - r.top - 66) / mmCam.z + mmCam.y;
    P.cancelFlight();
    P.setCamera({ x, y });
  };
  let mmDown = false;
  mm.addEventListener("pointerdown", (e) => { mmDown = true; mm.setPointerCapture(e.pointerId); mmNav(e); });
  mm.addEventListener("pointermove", (e) => mmDown && mmNav(e));
  mm.addEventListener("pointerup", () => (mmDown = false));
  const rebuildMM = P.debounce(() => drawMinimap(true), 200);
  P.on("project", rebuildMM);
  P.on("camera", () => {
    drawMinimap(false);
    P.requestOverlay();
    $("#zoom-pct").textContent = (S.cam.z >= 10 ? Math.round(S.cam.z) * 100 : Math.round(S.cam.z * 100)) + "%";
  });

  /* ================= Command palette & shortcuts dialog ================= */
  function openDialog(node, onClose) {
    closePopovers();
    const scrim = h("div", { class: "scrim" });
    scrim.appendChild(node);
    $("#popover-layer").appendChild(scrim);
    P.hydrateIcons(node);
    const close = () => { scrim.remove(); document.removeEventListener("keydown", esc_, true); onClose && onClose(); stage.focus(); };
    const esc_ = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
    document.addEventListener("keydown", esc_, true);
    scrim.addEventListener("pointerdown", (e) => { if (e.target === scrim) close(); });
    return close;
  }
  P.openDialog = openDialog;
  function openPalette() {
    const dlg = h("div", { class: "dialog", role: "dialog", "aria-label": "Command menu" });
    dlg.innerHTML = `<div class="palette-wrap">${icon("magnifying-glass")}<input class="palette-input" placeholder="Type a command or search frames" aria-label="Search commands"></div><div class="palette-list" role="listbox"></div>`;
    const input = dlg.querySelector("input"), listEl = dlg.querySelector(".palette-list");
    let items = [], kb = 0;
    const close = openDialog(dlg);
    dlg.parentNode.classList.add("instant");
    const render = () => {
      const q = input.value.trim().toLowerCase();
      const cmds = P.commands.filter((c) => !c.hidden && (!q || c.label.toLowerCase().includes(q)));
      const objs = q ? P.allObjects().filter((o) => P.objTitle(o).toLowerCase().includes(q)).slice(0, 8).map((o) => ({ label: "Go to " + P.objTitle(o), icon: P.isFrame(o) ? "frame-corners" : "crosshair", run: () => { P.select(o.id); P.flyTo(P.cameraFor(o), { duration: 900 }); } })) : [];
      items = [...cmds, ...objs];
      kb = Math.min(kb, Math.max(0, items.length - 1));
      listEl.innerHTML = items.length ? "" : `<div class="palette-empty">Nothing matches "${esc(q)}"</div>`;
      items.forEach((c, i) => {
        const b = h("button", { class: "menu-item" + (i === kb ? " kb" : ""), role: "option" }, `${icon(c.icon || "lightning")}<span class="grow"><span class="t">${esc(c.label)}</span></span>${c.kbd ? `<kbd>${c.kbd}</kbd>` : ""}`);
        b.onclick = () => { close(); c.run(); };
        b.onmouseenter = () => { kb = i; $$(".menu-item", listEl).forEach((x, j) => x.classList.toggle("kb", j === i)); };
        listEl.appendChild(b);
      });
    };
    input.oninput = () => { kb = 0; render(); };
    input.onkeydown = (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); kb = Math.min(items.length - 1, kb + 1); render(); listEl.querySelector(".kb")?.scrollIntoView({ block: "nearest" }); }
      else if (e.key === "ArrowUp") { e.preventDefault(); kb = Math.max(0, kb - 1); render(); listEl.querySelector(".kb")?.scrollIntoView({ block: "nearest" }); }
      else if (e.key === "Enter") { e.preventDefault(); const c = items[kb]; if (c) { close(); c.run(); } }
      e.stopPropagation();
    };
    render();
    input.focus();
  }
  function openShortcuts() {
    const groups = [
      ["Tools", [["Select", "V"], ["Pan", "H or hold Space"], ["Frame", "F"], ["Text", "T or double-click"], ["Shape", "S"], ["Image", "I or paste"]]],
      ["Canvas", [["Zoom", "Pinch or ⌘ scroll"], ["Fit everything", "⇧1"], ["Zoom to selection", "⇧2"], ["Reset zoom", "0"], ["Minimap", "M"], ["Commands", "⌘K"]]],
      ["Editing", [["Undo / redo", "⌘Z  ⇧⌘Z"], ["Duplicate", "⌘D or ⌥ drag"], ["Delete", "⌫"], ["Nudge", "Arrows, ⇧ for 10x"], ["Wrap in frame", "⌘G"], ["Bring forward / back", "]  ["]]],
      ["Path & present", [["Add to path", "⇧A"], ["Present", "⌘↵"], ["Next / previous", "→  ←"], ["Overview", "O"], ["Laser / blackout", "L  B"], ["Presenter view", "P"]]],
    ];
    const dlg = h("div", { class: "dialog wide", role: "dialog", "aria-label": "Keyboard shortcuts" });
    dlg.innerHTML = `<div class="dlg-head"><h2>Keyboard shortcuts</h2><button class="icon-btn sm" aria-label="Close">${icon("x")}</button></div><div class="dlg-body"><div class="shortcut-grid">${groups.map(([g, rows]) => `<h3>${g}</h3>` + rows.map(([a, b]) => `<div class="sc"><span>${a}</span><span>${b.split("  ").map((k) => `<kbd>${esc(k)}</kbd>`).join("")}</span></div>`).join("")).join("")}</div></div>`;
    const close = openDialog(dlg);
    dlg.querySelector(".icon-btn").onclick = close;
  }

  /* ================= Tooltips ================= */
  const tip = $("#tooltip");
  let tipTimer = 0, tipFor = null, tipWarmUntil = 0;
  document.addEventListener("pointerover", (e) => {
    const t = e.target.closest("[data-tip]");
    if (t === tipFor) return;
    clearTimeout(tipTimer);
    if (!tip.hidden) tipWarmUntil = performance.now() + 500;
    tip.hidden = true;
    tipFor = t;
    if (!t || e.pointerType === "touch") return;
    tipTimer = setTimeout(() => {
      tip.innerHTML = esc(t.dataset.tip) + (t.dataset.kbd ? `<kbd>${esc(t.dataset.kbd)}</kbd>` : "");
      tip.hidden = false;
      const r = t.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
      const below = r.top < 120;
      tip.style.left = P.clamp(r.left + r.width / 2 - tw / 2, 6, window.innerWidth - tw - 6) + "px";
      tip.style.top = (below ? r.bottom + 8 : r.top - th - 8) + "px";
    }, 420);
  });
  document.addEventListener("pointerdown", () => { clearTimeout(tipTimer); tip.hidden = true; });

  /* ================= Keyboard ================= */
  const isTyping = (t) => t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
  window.addEventListener("keydown", (e) => {
    if (S.mode === "present" || S.mode === "presenter") return;
    if (e.key === " " && !isTyping(e.target)) { if (!spaceDown) { spaceDown = true; stage.classList.add("space-pan"); } e.preventDefault(); return; }
    if (isTyping(e.target)) { if (e.key === "Escape") e.target.blur(); return; }
    if ($(".scrim")) return;
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    const run = (fn) => { e.preventDefault(); fn(); };
    if (mod) {
      if (k === "z") return run(() => (e.shiftKey ? P.redo() : P.undo()));
      if (k === "y") return run(P.redo);
      if (k === "k") return run(openPalette);
      if (k === "d") return run(P.duplicate);
      if (k === "a") return run(() => P.select(P.allObjects().map((o) => o.id)));
      if (k === "g") return run(P.wrapInFrame);
      if (k === "o") return run(() => P.run("outline"));
      if (k === "s") return run(() => P.flush().then(() => P.toast("Saved to this computer", "check")));
      if (k === "enter") return run(() => P.present(e.shiftKey ? Math.max(0, S.step) : 0));
      if (k === "=" || k === "+") return run(() => P.run("zoom-in"));
      if (k === "-") return run(() => P.run("zoom-out"));
      return;
    }
    if (e.altKey) return;
    if (e.shiftKey && k === "a") return run(P.addStepFromView);
    if (e.shiftKey && e.code === "Digit1") return run(() => P.fitAll());
    if (e.shiftKey && e.code === "Digit2") return run(() => P.run("zoom-selection"));
    if (e.shiftKey && k === "?") return run(openShortcuts);
    switch (e.key) {
      case "Escape":
        if (openPop) return run(closePopovers);
        if (S.tool !== "select") return run(() => P.setTool("select"));
        return run(P.clearSelection);
      case "Delete": case "Backspace": return run(P.deleteSelection);
      case "Enter": {
        const o = P.selected()[0];
        if (o && !P.isFrame(o) && o.kind === "text") return run(() => startEditing(o.id));
        if (o) return run(() => P.flyTo(P.cameraFor(o), { duration: 850 }));
        return;
      }
      case "ArrowLeft": case "ArrowRight": case "ArrowUp": case "ArrowDown": {
        const st = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -st : e.key === "ArrowRight" ? st : 0, dy = e.key === "ArrowUp" ? -st : e.key === "ArrowDown" ? st : 0;
        if (S.selection.size) return run(() => P.nudge(dx, dy));
        if (dx) return run(() => P.goToStepEdit(S.step + Math.sign(dx)));
        return;
      }
      case "[": return run(() => P.reorder(-1));
      case "]": return run(() => P.reorder(1));
      case "0": return run(() => P.run("zoom-100"));
    }
    const tools = { v: "select", h: "hand", f: "frame", t: "text", s: "shape" };
    if (tools[k]) return run(() => P.setTool(tools[k]));
    if (k === "i") return run(() => P.run("image"));
    if (k === "m") return run(() => P.run("toggle-minimap"));
  });
  window.addEventListener("keyup", (e) => { if (e.key === " ") { spaceDown = false; stage.classList.remove("space-pan"); } });
  window.addEventListener("blur", () => { spaceDown = false; stage.classList.remove("space-pan"); });

  /* ================= Command registry ================= */
  const zoomBy = (f) => P.flyTo({ ...S.cam, z: S.cam.z * f }, { duration: 280 });
  cmd("present", "Present from the start", () => P.present(0), { icon: "play", kbd: "⌘↵" });
  cmd("present-here", "Present from current step", () => P.present(Math.max(0, S.step)), { icon: "monitor-play", kbd: "⇧⌘↵" });
  cmd("outline", "Build from outline", (arg) => P.openOutline(arg), { icon: "magic-wand", kbd: "⌘O" });
  cmd("add-step", "Add selection or view to path", P.addStepFromView, { icon: "path", kbd: "⇧A" });
  cmd("undo", "Undo", P.undo, { icon: "arrow-counter-clockwise", kbd: "⌘Z" });
  cmd("redo", "Redo", P.redo, { icon: "arrow-clockwise", kbd: "⇧⌘Z" });
  cmd("palette", "Command menu", openPalette, { icon: "command", kbd: "⌘K", hidden: true });
  cmd("tool-frame", "Draw a frame", () => P.setTool("frame"), { icon: "frame-corners", kbd: "F" });
  cmd("tool-text", "Add text", () => P.setTool("text"), { icon: "text-t", kbd: "T" });
  cmd("tool-shape", "Draw a shape", () => P.setTool("shape"), { icon: "shapes", kbd: "S" });
  cmd("image", "Insert image", () => { replaceTarget = null; $("#file-image").click(); }, { icon: "image", kbd: "I" });
  cmd("fit", "Fit everything", () => P.fitAll(), { icon: "corners-out", kbd: "⇧1" });
  cmd("zoom-selection", "Zoom to selection", () => { const sel = P.selected(); if (sel.length) P.flyTo(P.cameraFor(sel.length === 1 ? sel[0] : P.boundsOf(sel)), { duration: 800 }); }, { icon: "crosshair", kbd: "⇧2" });
  cmd("zoom-in", "Zoom in", () => zoomBy(1.6), { icon: "plus", kbd: "⌘+" });
  cmd("zoom-out", "Zoom out", () => zoomBy(1 / 1.6), { icon: "minus", kbd: "⌘-" });
  cmd("zoom-100", "Zoom to 100%", () => P.flyTo({ ...S.cam, z: 1 }, { duration: 400 }), { icon: "magnifying-glass", kbd: "0" });
  cmd("toggle-minimap", "Toggle minimap", () => { S.showMinimap = !S.showMinimap; $("#minimap-wrap").classList.toggle("off", !S.showMinimap); $('[data-cmd="toggle-minimap"]').classList.toggle("on", S.showMinimap); drawMinimap(true); }, { icon: "map-trifold", kbd: "M" });
  cmd("toggle-path-line", "Show or hide the path line", () => { S.showPath = !S.showPath; P.renderPathLine(); const b = $('[data-cmd="toggle-path-line"]'); b.innerHTML = icon(S.showPath ? "eye" : "eye-slash"); b.classList.toggle("on", !S.showPath); }, { icon: "eye" });
  cmd("toggle-rail", "Show or hide the path rail", () => { const r = $("#path-rail"); const c = !r.classList.contains("collapsed"); r.classList.toggle("collapsed", c); r.classList.toggle("force-open", !c); $("#rail-open").hidden = !c; }, { icon: "path" });
  cmd("duplicate", "Duplicate selection", P.duplicate, { icon: "copy", kbd: "⌘D" });
  cmd("delete", "Delete selection", P.deleteSelection, { icon: "trash", kbd: "⌫" });
  cmd("wrap", "Wrap selection in a frame", P.wrapInFrame, { icon: "frame-corners", kbd: "⌘G" });
  cmd("select-all", "Select everything", () => P.select(P.allObjects().map((o) => o.id)), { icon: "selection-all", kbd: "⌘A" });
  cmd("new-deck", "New blank deck", () => newDeck({ template: "blank" }), { icon: "file-plus" });
  cmd("starter", "Open the starter tour", () => newDeck({ template: "starter" }), { icon: "sparkle" });
  cmd("export-html", "Export offline HTML player", () => $("#btn-export").click(), { icon: "file-html" });
  cmd("theme", "Change theme", () => $("#btn-theme").click(), { icon: "palette" });
  cmd("shortcuts", "Keyboard shortcuts", openShortcuts, { icon: "keyboard", kbd: "?" });

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cmd]");
    if (b && !b.closest("#present-hud")) P.run(b.dataset.cmd);
  });

  window.addEventListener("resize", P.debounce(() => { P.applyCamera(); drawMinimap(true); scheduleThumbs(); }, 80));
  P.renderOverlay = renderOverlay;
  P.renderInspector = renderInspector;
  P.renderPath = renderPath;
})();
