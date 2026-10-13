// Common empty/error states for Accounts and Admin screens.
window.WorkspaceUI = {
  state(target, { title, message, action, onAction, href, error = false }) {
    if (!target) return;
    const panel = document.createElement("div");
    panel.className = `workspace-state${error ? " is-error" : ""}`;
    panel.setAttribute("role", error ? "alert" : "status");
    const heading = document.createElement("strong");
    heading.textContent = title;
    const detail = document.createElement("p");
    detail.textContent = message;
    panel.append(heading, detail);
    if (action) {
      const control = document.createElement(href ? "a" : "button");
      control.className = "workspace-action";
      control.textContent = action;
      if (href) control.href = href;
      else { control.type = "button"; control.addEventListener("click", onAction); }
      panel.append(control);
    }
    target.replaceChildren(panel);
  },
  localDate(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  },
};
