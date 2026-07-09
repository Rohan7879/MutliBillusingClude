/**
 * @file themes.js
 * @description MandiBook Theme System - 8 themes
 * Theme panel, toggle, and bill-list auto-init all hardcoded here.
 */

const THEMES = [
  { id: "blue",   name: "Ocean Blue",    emoji: "🔵", color: "#005a9e" },
  { id: "green",  name: "Forest Green",  emoji: "🟢", color: "#28a745" },
  { id: "purple", name: "Royal Purple",  emoji: "🟣", color: "#6f42c1" },
  { id: "orange", name: "Sunset Orange", emoji: "🟠", color: "#fd7e14" },
  { id: "teal",   name: "Deep Teal",     emoji: "🩵", color: "#17a2b8" },
  { id: "red",    name: "Rose Red",      emoji: "🔴", color: "#dc3545" },
  { id: "dark",   name: "Dark Mode",     emoji: "⚫", color: "#1a1a2e" },
  { id: "brown",  name: "Earthy Brown",  emoji: "🟤", color: "#8b5e3c" },
];

// ── Apply theme immediately (before DOM loads) to prevent flash ──
(function() {
  const saved = localStorage.getItem("mandibook_theme") || "blue";
  document.documentElement.setAttribute("data-theme", saved);
})();

function applyTheme(themeId) {
  document.documentElement.setAttribute("data-theme", themeId);
  localStorage.setItem("mandibook_theme", themeId);
  document.querySelectorAll(".theme-dot").forEach(d => {
    d.classList.toggle("active", d.dataset.theme === themeId);
  });
  document.querySelectorAll(".theme-name-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.theme === themeId);
  });
  const panel = document.getElementById("theme-panel");
  if (panel) panel.classList.remove("open");
}

function renderThemeSwitcher() {
  const saved = localStorage.getItem("mandibook_theme") || "blue";

  // Inject theme panel into DOM if not already there
  if (!document.getElementById("theme-panel")) {
    const panel = document.createElement("div");
    panel.id = "theme-panel";
    panel.className = "theme-panel";
    panel.innerHTML = `
      <div class="theme-panel-title">🎨 Select Theme</div>
      <div id="theme-switcher"></div>
      <div id="theme-names" class="theme-names"></div>`;
    document.body.appendChild(panel);
  }

  // Render dot buttons
  const dotEl = document.getElementById("theme-switcher");
  if (dotEl) {
    dotEl.innerHTML = THEMES.map(t => `
      <button class="theme-dot ${t.id === saved ? 'active' : ''}"
        data-theme="${t.id}" title="${t.name}"
        onclick="applyTheme('${t.id}')"
        style="background:${t.color};"></button>`
    ).join("");
  }

  // Render name buttons
  const nameEl = document.getElementById("theme-names");
  if (nameEl) {
    nameEl.innerHTML = THEMES.map(t => `
      <button class="theme-name-btn ${t.id === saved ? 'active' : ''}"
        data-theme="${t.id}"
        onclick="applyTheme('${t.id}')">${t.emoji} ${t.name}</button>`
    ).join("");
  }
}

function toggleThemePanel(event) {
  const panel = document.getElementById("theme-panel");
  if (panel) panel.classList.toggle("open");
  if (event) event.stopPropagation();
}

// Close panel on outside click
document.addEventListener("click", function(e) {
  const panel = document.getElementById("theme-panel");
  if (panel && panel.classList.contains("open")) {
    if (!e.target.closest(".theme-panel") && !e.target.closest(".theme-btn")) {
      panel.classList.remove("open");
    }
  }
});

document.addEventListener("DOMContentLoaded", () => {
  renderThemeSwitcher();

  // Auto-load bill list on bills.html
  if (document.getElementById("bill_list_view")) {
    if (typeof showBillListView === "function") showBillListView();
  }
});
