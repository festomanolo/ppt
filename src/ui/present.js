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
    stage.focus();
  };

  P.exitPresent = () => {
    if (S.mode !== "present" || S.embed) return;
    S.mode = "edit";
    body.dataset.mode = "edit";
    body.classList.remove("laser", "blackout");
    overview = false;
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    P.cancelFlight();
    P.render();
    P.updateReveal();
    const st = path()[S.step];
    const o = st && P.get(st.frame_id);
    if (o) P.flyTo(P.cameraFor(o), { duration: 500 });
    if (P.renderPath) P.renderPath();
    P.requestOverlay && P.requestOverlay();
    broadcast();
  };

  /* ---------- Navigation ---------- */
  async function goToStep(i, { first = false, instant = false } = {}) {
    if (!total()) return;
    i = P.clamp(i, 0, total() - 1);
    const back = i < S.step;
    const prevStep = S.step;
    S.step = i;
    overview = false;
    roaming = false;
    updateHud();
    broadcast();
    const st = path()[i];
    const cam = P.stepCamera(i);
    if (!cam) return;
    // Going back hides later reveals at once; going forward reveals after the camera lands.
    if (back || first) P.updateReveal();
    const kind = first ? "fade" : st.transition || "zoom";
    const dur = instant ? 0 : first ? 500 : st.transition_duration_ms || 1100;
    const done = await P.flyTo(cam, { duration: dur, kind: instant ? "cut" : kind });
    if (done && S.step === i) P.updateReveal();
    if (prevStep === i && done) P.updateReveal();
  }
  P.goToStep = goToStep;

  const next = () => {
    if (overview || roaming) return goToStep(Math.max(0, S.step));
    if (S.step >= total() - 1) { P.toast("End of the path. Press Esc to leave.", "check"); return; }
    goToStep(S.step + 1);
  };
  const prev = () => {
    if (overview || roaming) return goToStep(Math.max(0, S.step));
    if (S.step <= 0) return;
    goToStep(S.step - 1);
  };
  P.presentNext = next;
  P.presentPrev = prev;

  function toggleOverview() {
    if (overview) return goToStep(Math.max(0, S.step));
    overview = true;
    const b = P.boundsOf(P.allObjects());
    if (b) P.flyTo(P.cameraFor(b, 0.9), { duration: 1000 });
    updateHud();
  }

  function stepForObject(o) {
    let k = path().findIndex((s) => s.frame_id === o.id);
    if (k >= 0) return k;
    // Fall back to the smallest frame on the path that contains the clicked object.
    const c = P.center(o);
    const holders = P.frames().filter((f) => f !== o && P.contains(f, c)).sort((a, b) => a.width * a.height - b.width * b.height);
    for (const f of holders) { k = path().findIndex((s) => s.frame_id === f.id); if (k >= 0) return k; }
    return -1;
  }

  /* ---------- HUD & progress ---------- */
  function updateHud() {
    $("#hud-count").textContent = overview ? "Overview" : `${S.step + 1} / ${total()}`;
    $("#progress i").style.width = total() ? ((S.step + 1) / total()) * 100 + "%" : "0";
    const ov = hud.querySelector('[data-cmd="overview"]');
    if (ov) ov.classList.toggle("on", overview);
  }
  function showHud(ms = 2200) {
    if (S.mode !== "present") return;
    hud.classList.add("show");
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => { if (!hudHover) hud.classList.remove("show"); }, ms);
  }
  hud.addEventListener("pointerenter", () => { hudHover = true; showHud(); });
  hud.addEventListener("pointerleave", () => { hudHover = false; showHud(1200); });
  hud.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cmd]");
    if (!b) return;
    e.stopPropagation();
    run(b.dataset.cmd);
  });

  function run(cmd) {
    switch (cmd) {
      case "next": return next();
      case "prev": return prev();
      case "overview": return toggleOverview();
      case "laser": body.classList.toggle("laser"); hud.querySelector('[data-cmd="laser"]').classList.toggle("on", body.classList.contains("laser")); return;
      case "blackout": body.classList.toggle("blackout"); return;
      case "fullscreen": return toggleFullscreen();
      case "presenter": return openPresenter();
      case "exit-present": return P.exitPresent();
    }
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  }

  /* ---------- Pointer: click to advance, swipe, drag to roam, laser ---------- */
  let down = null;
  stage.addEventListener("pointerdown", (e) => {
    if (S.mode !== "present") return;
    if (body.classList.contains("blackout")) { body.classList.remove("blackout"); return; }
    down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, touch: e.pointerType === "touch", id: e.pointerId, button: e.button };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove", (e) => {
    if (S.mode !== "present") return;
    const l = $("#laser");
    if (body.classList.contains("laser")) l.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    if (e.pointerType !== "touch") showHud();
    if (!down) return;
    if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) down.moved = true;
    if (down.moved && !down.touch && !body.classList.contains("laser")) {
      P.panBy(e.clientX - down.lx, e.clientY - down.ly);
      roaming = true;
      updateHud();
    }
    down.lx = e.clientX; down.ly = e.clientY;
  });
  stage.addEventListener("pointerup", (e) => {
    if (S.mode !== "present" || !down) return;
    const d = down;
    down = null;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (d.touch && d.moved) {
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) (dx < 0 ? next : prev)();
      else if (dy > 80) toggleOverview();
      return;
    }
    if (d.moved) return;
    if (d.touch) showHud();
    if (overview) {
      const n = e.target.closest && e.target.closest("#world [data-id]");
      const o = n && P.get(n.dataset.id);
      if (o) {
        const k = stepForObject(o);
        if (k >= 0) return goToStep(k);
        overview = false; roaming = true;
        P.flyTo(P.cameraFor(o, 0.86), { duration: 900 });
        return updateHud();
      }
      return;
    }
    if (d.button === 2) return prev();
    if (d.touch && e.clientX < window.innerWidth * 0.25) return prev();
    next();
  });
  stage.addEventListener("contextmenu", (e) => { if (S.mode === "present") e.preventDefault(); });
  P.presentWheel = (e) => {
    P.wheelNav(e);
    roaming = true;
    updateHud();
  };

  /* ---------- Keyboard ---------- */
  window.addEventListener("keydown", (e) => {
    if (S.mode !== "present") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (/^[0-9]$/.test(k)) {
      stop();
      digits += k;
      clearTimeout(digitTimer);
      digitTimer = setTimeout(() => (digits = ""), 1400);
      $("#hud-count").textContent = `Go to ${digits}`;
      showHud();
      return;
    }
    switch (k) {
      case "Enter":
        stop();
        if (digits) { const n = parseInt(digits, 10); digits = ""; return goToStep(n - 1); }
        return next();
      case "ArrowRight": case "ArrowDown": case "PageDown": case " ": stop(); return next();
      case "ArrowLeft": case "ArrowUp": case "PageUp": case "Backspace": stop(); return prev();
      case "Home": stop(); return goToStep(0);
      case "End": stop(); return goToStep(total() - 1);
      case "Escape":
        stop();
        if (body.classList.contains("blackout")) return body.classList.remove("blackout");
        if (overview) return goToStep(Math.max(0, S.step));
        return P.exitPresent();
    }
    switch (k.toLowerCase()) {
      case "o": stop(); return toggleOverview();
      case "b": case ".": stop(); return run("blackout");
      case "l": stop(); return run("laser");
      case "f": stop(); return toggleFullscreen();
      case "p": stop(); return S.embed ? null : openPresenter();
    }
  });

  window.addEventListener("resize", P.debounce(() => {
    if (S.mode !== "present") return;
    if (overview) { const b = P.boundsOf(P.allObjects()); if (b) P.setCamera(P.cameraFor(b, 0.9)); }
    else if (!roaming) { const c = P.stepCamera(S.step); if (c) P.setCamera(c); }
  }, 60));

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
