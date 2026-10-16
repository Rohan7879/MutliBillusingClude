/* Form-only safety. Local drafts are NOT database records or recovery backups. */
(function () {
  "use strict";
  const operations = new Map();
  const drafts = new Set();
  const prefix = "mandibook:form-draft:v1:";
  const identity = () => {
    const user = window.firebase?.auth().currentUser;
    const project = window.firebase?.app().options.projectId;
    return user?.uid && project ? `${encodeURIComponent(project)}:${encodeURIComponent(user.uid)}:` : null;
  };
  // randomUUID needs HTTPS/localhost; getRandomValues also works on a LAN HTTP
  // preview. This ID separates local drafts, it is not an authentication token.
  const token = () => window.crypto.randomUUID?.() || [...window.crypto.getRandomValues(new Uint8Array(16))]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  function status(container) {
    let node = container.querySelector(":scope > .form-operation-status");
    if (!node) {
      node = document.createElement("p");
      node.className = "form-operation-status";
      node.setAttribute("role", "status");
      node.setAttribute("aria-live", "polite");
      container.prepend(node);
    }
    return node;
  }
  function errorMessage(error) {
    const code = String(error?.code || "");
    if (/permission-denied|unauthenticated/.test(code)) return "Access denied. Sign in with an approved account; your inputs are still here.";
    if (/unavailable|deadline-exceeded|network/.test(code)) return "Server confirmation was not received. Check your connection and the record list before retrying; your inputs are still here.";
    return "Save could not be confirmed. Your inputs are still here. Check the record list before retrying.";
  }
  function begin(key, { container, button, label = "Saving" } = {}) {
    if (operations.has(key)) return null;
    const node = status(container);
    if ([...drafts].some(draft => draft.container === container && !draft.owns())) {
      node.dataset.state = "error";
      node.textContent = "The signed-in account changed. Reload this page before editing or saving.";
      return null;
    }
    if (navigator.onLine === false) {
      node.dataset.state = "error";
      node.textContent = "You are offline. Reconnect before saving. Your inputs have not been cleared.";
      node.scrollIntoView({ block: "nearest" });
      return null;
    }
    const controls = [...container.querySelectorAll("input, select, textarea, button, a")];
    const old = controls.map(el => ({ el, inert: el.inert }));
    old.forEach(({ el }) => { el.inert = true; }); // Unlike disabled, keeps FormData intact.
    const buttonText = button?.textContent;
    const wasDisabled = button?.disabled;
    if (button) { button.disabled = true; button.textContent = `${label}…`; }
    container.setAttribute("aria-busy", "true");
    node.dataset.state = "busy";
    let confirmed = false;
    const showMessage = text => {
      node.textContent = text;
      if (document.getElementById("global-loader-ui")?.classList.contains("active")) {
        const globalText = document.getElementById("globalLoaderText");
        if (globalText) globalText.textContent = text;
      }
    };
    const update = () => {
      showMessage(confirmed ? "Record saved. Finishing follow-up work; do not submit it again." : navigator.onLine === false
        ? "Connection lost — waiting for server confirmation. Do not refresh or submit again."
        : `${label} is taking longer. Waiting for server confirmation; do not submit again.`);
    };
    node.textContent = `${label}… Please wait for confirmation.`;
    const timer = setTimeout(update, 10000);
    window.addEventListener("offline", update);
    window.addEventListener("online", update);
    let finished = false;
    const operation = {
      message(text, saved = false) { confirmed = saved; showMessage(text); },
      finish(text, state = "success") {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        window.removeEventListener("offline", update);
        window.removeEventListener("online", update);
        old.forEach(({ el, inert }) => { el.inert = inert; });
        if (button) { button.disabled = wasDisabled; button.textContent = buttonText; }
        container.removeAttribute("aria-busy");
        node.dataset.state = state;
        node.textContent = text;
        operations.delete(key);
      },
      fail(error) { operation.finish(errorMessage(error), "error"); },
    };
    operations.set(key, operation);
    return operation;
  }

  // Serialize values, not HTML, so restored drafts cannot inject markup/scripts.
  function fields(container) {
    return [...container.querySelectorAll("input, select, textarea")]
      .filter(el => (el.name || el.id) && !["password", "file", "submit", "button"].includes(el.type))
      .map(el => ({ key: el.name ? `name:${el.name}` : `id:${el.id}`, type: el.type,
        value: el.value, checked: !!el.checked }));
  }
  function restoreFields(container, saved) {
    const controls = [...container.querySelectorAll("input, select, textarea")];
    const apply = () => {
      const used = new Map();
      for (const field of saved || []) {
        const matches = controls.filter(el => (el.name ? `name:${el.name}` : `id:${el.id}`) === field.key && el.type === field.type);
        const index = used.get(field.key) || 0;
        const el = matches[index];
        used.set(field.key, index + 1);
        if (!el || typeof field.value !== "string") continue;
        if (["radio", "checkbox"].includes(el.type)) el.checked = !!field.checked;
        else el.value = field.value;
      }
    };
    apply();
    // Toggle listeners also set defaults. Reapply values afterwards so an OFF
    // deduction or a custom numeric value is never silently replaced.
    controls.filter(el => ["checkbox", "radio"].includes(el.type) && (el.type !== "radio" || el.checked))
      .forEach(el => el.dispatchEvent(new Event("change", { bubbles: true })));
    apply();
    container.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function createDraft({ container, kind, capture, restore, active = () => true }) {
    const owner = identity();
    if (!owner || !container) return null;
    const scope = prefix + owner + encodeURIComponent(kind) + ":";
    // Separate draft per tab/editor. One tab must not overwrite another's input.
    const key = scope + token();
    let candidate = null, dirty = false, restoring = false, disposed = false, timer;
    let baseline = JSON.stringify(capture());
    const panel = document.createElement("section");
    panel.className = "form-draft-status";
    panel.setAttribute("aria-label", "Local draft recovery");
    const note = document.createElement("span");
    note.setAttribute("role", "status");
    const resume = document.createElement("button");
    resume.type = "button"; resume.textContent = "Restore draft";
    const discard = document.createElement("button");
    discard.type = "button"; discard.textContent = "Discard saved draft";
    panel.append(note, resume, discard);
    container.prepend(panel);
    const current = () => !disposed && identity() === owner;
    function discover() {
      candidate = null;
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const itemKey = localStorage.key(i);
          if (!itemKey?.startsWith(scope) || itemKey === key) continue;
          const raw = localStorage.getItem(itemKey);
          if (!raw || raw.length > 250000) continue;
          try {
            const item = JSON.parse(raw);
            if (item.version === 1 && !item.submitted && item.data && Number.isFinite(item.at) && (!candidate || item.at > candidate.at)) candidate = { ...item, key: itemKey };
          } catch (_) { /* A damaged draft is never applied. */ }
        }
        render();
      } catch (_) { unavailable(); }
    }
    function unavailable() {
      note.textContent = "Browser storage unavailable/full. Draft is NOT saved locally. Keep this page open or copy your inputs.";
      panel.dataset.state = "error";
    }
    function render() {
      resume.hidden = discard.hidden = !candidate;
      panel.dataset.state = "";
      note.textContent = candidate
        ? `Unsubmitted ${kind.split(":")[0]} draft found (${new Date(candidate.at).toLocaleString()}). Restore it only if still needed.`
        : "Draft recovery on this browser only, for this signed-in account. Not a Firebase save or backup; avoid shared devices.";
    }
    function flush() {
      clearTimeout(timer);
      if (!current() || restoring || !dirty || !active()) return false;
      try {
        const raw = JSON.stringify({ version: 1, at: Date.now(), data: capture() });
        if (raw.length > 250000) throw new Error("Draft too large");
        localStorage.setItem(key, raw);
        if (!candidate) {
          panel.dataset.state = "";
          note.textContent = `Draft saved on this browser at ${new Date().toLocaleTimeString()}. Not submitted to Firebase. Keep a full backup separately.`;
        }
        return true;
      } catch (_) { unavailable(); return false; }
    }
    function changed() {
      if (!current() || restoring || !active()) return;
      dirty = JSON.stringify(capture()) !== baseline;
      clearTimeout(timer);
      if (dirty) timer = setTimeout(flush, 300);
      else {
        try { localStorage.removeItem(key); render(); } catch (_) { unavailable(); }
      }
    }
    resume.addEventListener("click", async () => {
      if (!current() || !candidate || operations.size) return;
      if (dirty && !window.confirm("Replace the inputs currently on this page with the saved draft?")) return;
      restoring = true;
      try {
        await restore(candidate.data);
        dirty = true;
        restoring = false;
        if (flush()) {
          localStorage.removeItem(candidate.key);
          candidate = null;
          discover();
          if (!candidate) note.textContent = "Draft restored. Review the date, current rates, deductions and linked order before saving. Nothing was submitted.";
        }
      } catch (error) {
        note.textContent = error.message || "Draft could not be restored. The saved copy has been kept.";
        panel.dataset.state = "error";
      } finally { restoring = false; }
    });
    discard.addEventListener("click", () => {
      if (!current() || !candidate || operations.size || !window.confirm("Delete this saved local draft? This does not delete any Firebase record or current form input.")) return;
      try { localStorage.removeItem(candidate.key); discover(); } catch (_) { unavailable(); }
    });
    container.addEventListener("input", changed);
    container.addEventListener("change", changed);
    // Autocomplete and row add/remove buttons change fields without input events.
    const clicked = event => {
      // Recovery buttons manage their own state. A generic click check would
      // immediately replace a restore-conflict warning with the default note.
      if (!panel.contains(event.target)) setTimeout(changed, 0);
    };
    container.addEventListener("click", clicked);
    const controller = {
      container, owns: () => identity() === owner,
      flush, touch: changed,
      get dirty() { return current() && dirty; },
      confirmLeave() { flush(); return !dirty || window.confirm("This form has unsubmitted changes. Leave it? A local draft is only available if the draft status says it was saved."); },
      saved() {
        clearTimeout(timer); dirty = false; baseline = JSON.stringify(capture());
        try {
          // A tombstone prevents restoring a submitted form if removal fails.
          localStorage.setItem(key, JSON.stringify({ version: 1, submitted: true, at: Date.now() }));
          localStorage.removeItem(key);
        } catch (_) { unavailable(); }
      },
      dispose() {
        flush(); disposed = true; clearTimeout(timer);
        container.removeEventListener("input", changed);
        container.removeEventListener("change", changed);
        container.removeEventListener("click", clicked);
        panel.remove(); drafts.delete(controller);
      },
    };
    drafts.add(controller);
    discover();
    return controller;
  }
  window.addEventListener("beforeunload", event => {
    drafts.forEach(draft => draft.flush());
    if (operations.size || [...drafts].some(draft => draft.dirty)) {
      event.preventDefault(); event.returnValue = "";
    }
  });
  // Mobile browsers do not reliably dispatch beforeunload on app switching.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") drafts.forEach(draft => draft.flush());
  });
  window.addEventListener("pagehide", () => drafts.forEach(draft => draft.flush()));
  window.MandiFormSafety = { begin, isBusy: key => operations.has(key), errorMessage,
    fields, restoreFields, createDraft, identity };
})();
