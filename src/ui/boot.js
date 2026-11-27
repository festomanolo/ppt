/* Prezi-RS boot: load themes and the deck, wire chrome, choose edit, present or presenter mode. */
(function () {
  "use strict";
  const P = window.P, S = P.state, $ = P.$;
  const params = new URLSearchParams(location.search);

  async function load() {
    if (window.__EMBED__) return window.__EMBED__;
    const [themes, project] = await Promise.all([P.api("/api/themes"), P.api("/api/project")]);
    return { themes, project };
  }

  function restoreBackup(project) {
    try {
      const raw = localStorage.getItem("prezi-rs-backup");
      if (!raw) return project;
      const b = JSON.parse(raw);
      if (b && b.id === project.id) {
        setTimeout(() => { P.toast("Restored changes saved while offline", "arrows-clockwise"); P.save(); }, 600);
        return b;
      }
    } catch (_) {}
    return project;
  }

  async function start() {
    P.hydrateIcons();
    let data;
    try { data = await load(); }
    catch (e) {
      document.body.insertAdjacentHTML("beforeend", `<div class="scrim"><div class="dialog"><div class="dlg-head"><h2>Cannot reach the local server</h2></div><div class="dlg-body"><p class="hint">Start it with <kbd>cargo run -- serve</kbd> and reload this page.</p></div></div></div>`);
      return;
    }
    S.themes = data.themes;
    S.project = S.embed ? data.project : restoreBackup(data.project);
    if (!S.project.elements) S.project.elements = [];
    P.applyTheme(S.project.theme_id);

    if (params.has("presenter")) { await document.fonts.ready; return P.startPresenterView(); }

    $("#deck-title").value = S.project.name || "";
    if (S.embed) document.body.classList.add("embed");
    P.setTool("select");
    P.render();
    if (P.renderPath) P.renderPath();
    // Fonts change text metrics, so measure again once they are in.
    document.fonts.ready.then(() => { P.measureTexts(); P.render(); P.scheduleThumbs && P.scheduleThumbs(true); P.drawMinimap && P.drawMinimap(true); });

    if (S.embed) {
      document.title = S.project.name;
      P.fitAll(false);
      requestAnimationFrame(() => P.present(0));
      return;
    }
    const first = S.project.presentation_path[0];
    const o = first && P.get(first.frame_id);
    if (P.allObjects().length > 2 && o) P.fitAll(false);
    else if (o) P.setCamera(P.cameraFor(o));
    else P.setCamera({ x: 0, y: 0, z: 1, r: 0 });
    P.emit("selection");
    if (params.has("present")) P.present(0);
  }

  // Last-chance save when the tab closes; keepalive lets the request outlive the page.
  window.addEventListener("pagehide", () => {
    if (S.embed || !S.project || S.mode === "presenter") return;
    try { fetch("/api/project", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(S.project), keepalive: true }); } catch (_) {}
  });
  start();
})();
