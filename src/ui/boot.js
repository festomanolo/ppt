/* Prezi-RS boot: loads themes and the active deck, then hands off to the editor or the player. */
(async function () {
  "use strict";
  const P = window.P, S = P.state, $ = P.$, $$ = P.$$, icon = P.icon;
  const BACKUP = "prezi-rs-backup";
  P.hydrateIcons();

  // Presenter view: a second window driven by the one that opened it.
  if (location.hash === "#presenter") { P.initPresenterWindow(); return; }

  if (S.embed) document.body.classList.add("embed");

  async function load() {
    if (S.embed) return { themes: window.__EMBED__.themes || [], project: window.__EMBED__.project };
    const [themes, project] = await Promise.all([P.api("/api/themes"), P.api("/api/project")]);
    return { themes, project };
  }

  let data;
  try { data = await load(); } catch (_) { return offline(); }
  S.themes = data.themes;
  let project = data.project;

  // Edits that never reached the server were kept in localStorage; bring them back.
  let recovered = false;
  if (!S.embed) {
    try {
      const raw = localStorage.getItem(BACKUP);
      if (raw) {
        const bp = JSON.parse(raw);
        if (bp && bp.id === project.id && raw !== JSON.stringify(project)) { project = bp; recovered = true; }
        else localStorage.removeItem(BACKUP);
      }
    } catch (_) {}
  }

  P.loadProject(project);
  const title = $("#deck-title");
  title.value = S.project.name;
  P.setTool("select");
  $('[data-cmd="toggle-minimap"]').classList.toggle("on", S.showMinimap);

  const syncChrome = () => {
    if (document.activeElement !== title) title.value = S.project.name;
    document.title = (S.project.name || "Untitled") + (S.embed ? "" : " · Prezi-RS");
    $$('[data-cmd="undo"]').forEach((b) => (b.disabled = !S.history.length));
    $$('[data-cmd="redo"]').forEach((b) => (b.disabled = !S.future.length));
  };
  P.on("project", syncChrome);
  P.on("selection", syncChrome);
  syncChrome();

  if (recovered) { P.save(); P.toast("Recovered edits that had not been saved yet", "arrow-counter-clockwise"); }

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
