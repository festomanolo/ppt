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
    P.present(0);
  } else {
    try {
      if (!localStorage.getItem("prezi-rs-seen")) {
        localStorage.setItem("prezi-rs-seen", "1");
        setTimeout(() => P.toast("Press ⌘K for every command, or ? for shortcuts", "keyboard"), 900);
      }
    } catch (_) {}
    // Last chance to keep unsaved edits if the tab closes mid-save.
    window.addEventListener("pagehide", () => {
      if (!P.hasUnsaved()) return;
      const body = JSON.stringify(S.project);
      try { localStorage.setItem(BACKUP, body); } catch (_) {}
      if (body.length < 60000) {
        try { fetch("/api/project", { method: "PUT", headers: { "Content-Type": "application/json" }, body, keepalive: true }); } catch (_) {}
      }
    });
  }
  document.body.classList.add("ready");

  function offline() {
    const es = $("#empty-state");
    es.hidden = false;
    es.innerHTML = `<h2>Studio server not reachable</h2><p>The editor saves to a local server on this computer. Start it with <kbd>cargo run -- serve</kbd>, then try again.</p><div class="row"><button class="btn btn-primary" id="retry">${icon("arrows-clockwise")}Try again</button></div>`;
    $("#retry").onclick = () => location.reload();
    document.body.classList.add("ready", "offline");
  }
})();
