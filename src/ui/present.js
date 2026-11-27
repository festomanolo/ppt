/* Prezi-RS present mode: path playback, reveals, overview, laser, blackout and presenter view. */
(function () {
  "use strict";
  const P = window.P, S = P.state, $ = P.$, $$ = P.$$, h = P.h, icon = P.icon, esc = P.esc;
  const body = document.body;
  const steps = () => (S.project ? S.project.presentation_path : []);

  let enteredFs = false;
  let overview = false;
  let token = 0;
  let digits = "", digitTimer = 0;
  let presenterWin = null;

  /* ---------- HUD ---------- */
  const hud = $("#present-hud");
  let hudTimer = 0, idleTimer = 0;
  function showHud(ms = 2400) {
    hud.classList.add("show");
    body.classList.remove("idle");
    clearTimeout(hudTimer);
    clearTimeout(idleTimer);
    hudTimer = setTimeout(() => { if (!hud.matches(":hover")) hud.classList.remove("show"); }, ms);
    idleTimer = setTimeout(() => S.mode === "present" && body.classList.add("idle"), ms + 400);
  }
  function syncHud() {
    const n = steps().length, i = Math.max(0, S.step);
    $("#hud-count").textContent = n ? `${i + 1} / ${n}` : "0 / 0";
    $("#progress i").style.width = n ? ((i + 1) / n) * 100 + "%" : "0";
    $('#present-hud [data-cmd="overview"]').classList.toggle("on", overview);
    $('#present-hud [data-cmd="laser"]').classList.toggle("on", body.classList.contains("laser"));
    $('#present-hud [data-cmd="prev"]').disabled = i <= 0 && !overview;
    $('#present-hud [data-cmd="next"]').disabled = i >= n - 1 && !overview;
    const fs = $('#present-hud [data-cmd="fullscreen"]');
    fs.innerHTML = icon(document.fullscreenElement ? "arrows-in" : "arrows-out-cardinal");
  }

  /* ---------- Navigation ---------- */
  const sameView = (a, b) => Math.abs(a.x - b.x) * a.z < 1 && Math.abs(a.y - b.y) * a.z < 1 && Math.abs(a.z / b.z - 1) < 0.01 && Math.abs(a.r - b.r) < 0.001;

  function go(i, { instant = false } = {}) {
    const n = steps().length;
    if (!n) return;
    i = P.clamp(i, 0, n - 1);
    const back = i < S.step;
    overview = false;
    S.step = i;
    // Going back hides what had not been revealed yet; going forward reveals on arrival.
    if (back || instant) P.updateReveal();
    syncHud();
    notifyPresenter();
    const st = steps()[i];
    const cam = P.stepCamera(i);
    const my = ++token;
    if (!cam) return;
    if (instant || sameView(S.cam, cam)) { P.cancelFlight(); P.setCamera(cam); P.updateReveal(); return; }
    P.flyTo(cam, { duration: st.transition_duration_ms || 1100, kind: st.transition || "zoom" }).then((done) => {
      if (done && my === token) P.updateReveal();
    });
  }
  P.presentGo = go;
  const next = () => (overview ? go(S.step) : S.step >= steps().length - 1 ? showHud() : go(S.step + 1));
  const prev = () => (overview ? go(S.step) : go(S.step - 1));

  function toggleOverview() {
    if (overview) return go(S.step);
    overview = true;
    token++;
    const b = P.boundsOf(P.allObjects());
    if (b) P.flyTo(P.cameraFor(b, 0.9), { duration: 1000 });
    syncHud();
  }

  /* ---------- Enter / exit ---------- */
  P.present = (i = 0) => {
    if (!S.project) return;
    if (!steps().length) {
      if (S.embed) return;
      return P.toast("The path is empty. Select something and press ⇧A to add a step.", "path");
    }
    P.finishEditing && P.finishEditing();
    P.closePopovers && P.closePopovers();
    $$(".scrim").forEach((s) => s.remove());
    S.mode = "present";
    body.dataset.mode = "present";
    $("#inspector").hidden = true;
    $("#tooltip").hidden = true;
    S.step = -1;
    P.render();
    if (!S.embed && document.fullscreenEnabled && !document.fullscreenElement) {
      document.documentElement.requestFullscreen({ navigationUI: "hide" }).then(() => { enteredFs = true; syncHud(); }).catch(() => {});
    }
    S.step = Math.max(-1, Math.min(i, steps().length) - 1);
    P.updateReveal();
    go(i);
    showHud(3200);
    $("#stage").focus({ preventScroll: true });
  };

  P.exitPresent = () => {
    if (S.mode !== "present" || S.embed) return;
    token++;
    P.cancelFlight();
    S.mode = "edit";
    body.dataset.mode = "edit";
    body.classList.remove("laser", "blackout", "idle");
    hud.classList.remove("show");
    overview = false;
    if (document.fullscreenElement && enteredFs) document.exitFullscreen().catch(() => {});
    enteredFs = false;
    P.render();
    P.renderPath();
    P.renderInspector();
    P.requestOverlay();
    P.drawMinimap(true);
    const st = steps()[S.step];
    const o = st && P.get(st.frame_id);
    if (o) setTimeout(() => S.mode === "edit" && P.flyTo(P.cameraFor(o), { duration: 450 }), 60);
    if (presenterWin && !presenterWin.closed) presenterWin.postMessage({ type: "prezi-end" }, "*");
  };

  document.addEventListener("fullscreenchange", () => {
    if (S.mode !== "present") return;
    syncHud();
    // Leaving full screen with Esc ends the show, as in Keynote.
    if (!document.fullscreenElement && enteredFs) { enteredFs = false; P.exitPresent(); }
  });
  function toggleFullscreen() {
    if (document.fullscreenElement) { enteredFs = false; document.exitFullscreen().catch(() => {}); }
    else if (document.fullscreenEnabled) document.documentElement.requestFullscreen().then(() => { enteredFs = !S.embed; syncHud(); }).catch(() => {});
  }

  function toggleLaser(force) {
    const on = force != null ? force : !body.classList.contains("laser");
    body.classList.toggle("laser", on);
    syncHud();
  }
  function toggleBlackout() {
    body.classList.toggle("blackout");
    notifyPresenter();
  }

  /* ---------- Input ---------- */
  const HUD_CMDS = {
    prev, next,
    overview: toggleOverview,
    laser: () => toggleLaser(),
    presenter: () => openPresenter(),
    fullscreen: toggleFullscreen,
    "exit-present": () => P.exitPresent(),
  };
  hud.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cmd]");
    if (b && HUD_CMDS[b.dataset.cmd]) { e.stopPropagation(); HUD_CMDS[b.dataset.cmd](); showHud(); }
  });
  hud.addEventListener("pointerenter", () => clearTimeout(hudTimer));
  hud.addEventListener("pointerleave", () => showHud(1600));

  window.addEventListener("keydown", (e) => {
    if (S.mode !== "present") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    const take = (fn) => { e.preventDefault(); fn(); };
    if (/^[0-9]$/.test(k)) {
      digits += k;
      clearTimeout(digitTimer);
      digitTimer = setTimeout(() => (digits = ""), 1500);
      return take(() => {});
    }
    if (k === "Enter" && digits) { const n = parseInt(digits, 10); digits = ""; return take(() => go(n - 1)); }
    switch (k) {
      case "ArrowRight": case "ArrowDown": case "PageDown": case " ": case "Enter": return take(next);
      case "ArrowLeft": case "ArrowUp": case "PageUp": case "Backspace": return take(prev);
      case "Home": return take(() => go(0));
      case "End": return take(() => go(steps().length - 1));
      case "Escape":
        if (body.classList.contains("blackout")) return take(toggleBlackout);
        if (body.classList.contains("laser")) return take(() => toggleLaser(false));
        if (overview) return take(() => go(S.step));
        return take(() => P.exitPresent());
    }
    switch (k.toLowerCase()) {
      case "o": return take(toggleOverview);
      case "l": return take(() => toggleLaser());
      case "b": case ".": return take(toggleBlackout);
      case "p": return take(openPresenter);
      case "f": return take(toggleFullscreen);
    }
  });

  // Mouse: click advances, drag pans, a click on a smaller frame zooms into it.
  // Touch: swipe to navigate, drag to pan, pinch to zoom.
  const stage = $("#stage");
  const pts = new Map();
  let press = null, pinch = null;
  stage.addEventListener("pointerdown", (e) => {
    if (S.mode !== "present") return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      press = null;
      return;
    }
    if (e.button !== 0) return;
    stage.setPointerCapture(e.pointerId);
    press = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), moved: false, touch: e.pointerType !== "mouse", shift: e.shiftKey };
  });
  stage.addEventListener("pointermove", (e) => {
    if (S.mode !== "present") return;
    if (e.pointerType === "mouse") showHud();
    if (body.classList.contains("laser")) { const l = $("#laser"); l.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`; }
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      P.panBy(mid.x - pinch.mid.x, mid.y - pinch.mid.y);
      P.zoomAt(d / pinch.d, mid);
      pinch = { d, mid };
      token++;
      return;
    }
    if (!press || body.classList.contains("laser")) return;
    if (!press.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 6) return;
    if (!press.moved) { press.moved = true; stage.classList.add("panning"); }
    // Horizontal touch flicks navigate; everything else pans.
    if (!(press.touch && performance.now() - press.t < 260)) {
      P.panBy(e.clientX - press.lx, e.clientY - press.ly);
      token++;
    }
    press.lx = e.clientX; press.ly = e.clientY;
  });
  const up = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (S.mode !== "present" || !press) return;
    const p = press;
    press = null;
    stage.classList.remove("panning");
    if (body.classList.contains("laser")) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y, dt = performance.now() - p.t;
    if (p.touch && dt < 500 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) return dx < 0 ? next() : prev();
    if (p.moved) return;
    if (p.touch) { showHud(); return next(); }
    if (p.shift) return prev();
    clickInto({ x: e.clientX, y: e.clientY }) || next();
  };
  stage.addEventListener("pointerup", up);
  stage.addEventListener("pointercancel", up);
  stage.addEventListener("contextmenu", (e) => { if (S.mode === "present") { e.preventDefault(); prev(); } });

  /** Zooms into the smallest visible frame under the pointer that is not the current stop. */
  function clickInto(screen) {
    const w = P.screenToWorld(screen);
    const cur = steps()[S.step] && steps()[S.step].frame_id;
    const W = P.vw(), H = P.vh();
    const hit = P.frames()
      .filter((f) => f.style !== "invisible" && f.id !== cur && P.contains(f, w))
      .filter((f) => f.width * S.cam.z < W * 0.8 && f.height * S.cam.z < H * 0.8 && f.width * S.cam.z > 24)
      .sort((a, b) => a.width * a.height - b.width * b.height)[0];
    if (!hit) return false;
    // Prefer the path: if this frame is a later stop, jump there so the story continues from it.
    const idx = steps().findIndex((s, i) => s.frame_id === hit.id && i > S.step);
    const any = idx >= 0 ? idx : steps().findIndex((s) => s.frame_id === hit.id);
    if (any >= 0) { go(any); return true; }
    token++;
    overview = false;
    P.flyTo(P.cameraFor(hit), { duration: 900 });
    return true;
  }

  P.presentWheel = (e) => { token++; overview = false; P.wheelNav(e); showHud(); };

  window.addEventListener("resize", P.debounce(() => {
    if (S.mode !== "present" || overview) return;
    const cam = P.stepCamera(S.step);
    if (cam && !P.isFlying()) P.setCamera(cam);
  }, 120));

  /* ---------- Presenter view (second window, same origin) ---------- */
  function broadcast() {
    if (chan && !S.embed) chan.postMessage({ type: "state", step: S.step, total: total(), presenting: S.mode === "present" });
  }
  async function openPresenter() {
    if (S.embed) return;
    await P.flush();
    const w = window.open(location.pathname + "?presenter", "prezi-rs-presenter", "width=1180,height=760");
    if (!w) P.toast("Allow pop-ups to open the presenter view", "monitor-play");
    setTimeout(broadcast, 900);
  }
  P.openPresenter = openPresenter;
  if (chan && !location.search.includes("presenter")) {
    chan.onmessage = (ev) => {
      const m = ev.data || {};
      if (m.type === "hello") return broadcast();
      if (m.type !== "cmd") return;
      if (S.mode !== "present") { P.present(m.cmd === "goto" ? m.i : Math.max(0, S.step)); return; }
      if (m.cmd === "next") next();
      else if (m.cmd === "prev") prev();
      else if (m.cmd === "goto") goToStep(m.i);
      else if (m.cmd === "blackout") run("blackout");
    };
    P.on("project", P.debounce(() => chan.postMessage({ type: "project" }), 800));
  }

  /** Runs inside the presenter window. */
  P.startPresenterView = () => {
    S.mode = "presenter";
    body.dataset.mode = "presenter";
    const root = $("#presenter");
    root.hidden = false;
    root.innerHTML = `
      <div class="p-top">
        <div><div class="p-title" style="font-weight:600;font-size:15px"></div><div class="p-sub" data-count></div></div>
        <div style="text-align:center"><div class="p-clock" data-timer>00:00</div><div class="p-sub">Elapsed
          <button class="icon-btn sm" data-t="pause" aria-label="Pause timer" style="vertical-align:middle">${icon("pause")}</button>
          <button class="icon-btn sm" data-t="reset" aria-label="Reset timer" style="vertical-align:middle">${icon("arrow-counter-clockwise")}</button></div></div>
        <div style="text-align:right"><div class="p-clock" data-clock style="font-size:20px;color:var(--c-muted)"></div><div class="p-sub">Local time</div></div>
      </div>
      <div class="p-main">
        <canvas data-cur aria-label="Current step"></canvas>
        <div class="p-notes" data-notes></div>
      </div>
      <div class="p-side">
        <div class="insp-label">Up next</div>
        <canvas data-next aria-label="Next step"></canvas>
        <div class="p-sub" data-next-title style="font-size:14px;color:var(--c-text)"></div>
      </div>
      <div class="p-ctrl">
        <button class="btn" data-c="prev">${icon("caret-left")}Previous</button>
        <button class="btn" data-c="blackout">${icon("eye-slash")}Blackout</button>
        <button class="btn btn-primary" data-c="next">Next${icon("caret-right")}</button>
      </div>`;
    let step = 0, n = total(), t0 = Date.now(), paused = 0, pausedAt = 0;
    const q = (s) => root.querySelector(s);
    const send = (cmd, i) => chan && chan.postMessage({ type: "cmd", cmd, i });
    const notesFor = (i) => {
      const st = path()[i];
      const o = st && P.get(st.frame_id);
      return (o && o.notes) || "";
    };
    const draw = () => {
      n = total();
      q(".p-title").textContent = S.project.name;
      q("[data-count]").textContent = n ? `Step ${step + 1} of ${n}` : "No steps";
      P.drawStepThumb(q("[data-cur]"), step);
      const nc = q("[data-next]");
      if (step + 1 < n) {
        P.drawStepThumb(nc, step + 1);
        q("[data-next-title]").textContent = P.objTitle(P.get(path()[step + 1].frame_id));
      } else {
        const ctx = nc.getContext("2d");
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = (S.theme && S.theme.background) || "#111";
        ctx.fillRect(0, 0, nc.width, nc.height);
        q("[data-next-title]").textContent = "End of the path";
      }
      const notes = notesFor(step);
      const nn = q("[data-notes]");
      nn.classList.toggle("empty", !notes);
      nn.textContent = notes || "No notes for this step. Add them in the inspector under Speaker notes.";
    };
    const tick = () => {
      const el = Math.floor(((pausedAt || Date.now()) - t0 - paused) / 1000);
      q("[data-timer]").textContent = `${String(Math.floor(el / 60)).padStart(2, "0")}:${String(el % 60).padStart(2, "0")}`;
      q("[data-clock]").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    };
    setInterval(tick, 500);
    tick();
    root.addEventListener("click", (e) => {
      const c = e.target.closest("[data-c]");
      if (c) {
        if (c.dataset.c === "next" && step + 1 < n) { step++; draw(); }
        if (c.dataset.c === "prev" && step > 0) { step--; draw(); }
        send(c.dataset.c);
      }
      const t = e.target.closest("[data-t]");
      if (t && t.dataset.t === "reset") { t0 = Date.now(); paused = 0; pausedAt = 0; tick(); }
      if (t && t.dataset.t === "pause") {
        if (pausedAt) { paused += Date.now() - pausedAt; pausedAt = 0; t.innerHTML = icon("pause"); }
        else { pausedAt = Date.now(); t.innerHTML = icon("play"); }
      }
    });
    window.addEventListener("keydown", (e) => {
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) { e.preventDefault(); root.querySelector('[data-c="next"]').click(); }
      if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); root.querySelector('[data-c="prev"]').click(); }
      if (e.key.toLowerCase() === "b") send("blackout");
    });
    if (chan) {
      chan.onmessage = async (ev) => {
        const m = ev.data || {};
        if (m.type === "state" && m.step >= 0) { step = m.step; draw(); }
        if (m.type === "project") {
          try { S.project = await P.api("/api/project"); P.applyTheme(S.project.theme_id); draw(); } catch (_) {}
        }
      };
      chan.postMessage({ type: "hello" });
    }
    P.on("image-loaded", draw);
    window.addEventListener("resize", P.debounce(draw, 100));
    document.title = "Presenter: " + S.project.name;
    draw();
  };
})();
