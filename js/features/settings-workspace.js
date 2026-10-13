// Category selection affects only presentation; every existing form keeps its handlers.
document.addEventListener("DOMContentLoaded", () => {
  const navigation = document.querySelector(".settings-nav");
  if (!navigation) return;
  const sections = [...document.querySelectorAll("[data-settings-category]")];
  const buttons = [...navigation.querySelectorAll("[data-settings-view]")];
  const search = document.getElementById("settings-search");
  const clear = document.getElementById("settings-search-clear");
  const empty = document.getElementById("settings-search-empty");
  let selectedView = "billing";
  function render() {
    const query = search.value.trim().toLocaleLowerCase();
    let matches = 0;
    sections.forEach((section) => {
      section.hidden = query ? !section.textContent.toLocaleLowerCase().includes(query) : selectedView !== "all" && section.dataset.settingsCategory !== selectedView;
      if (!section.hidden) matches++;
    });
    buttons.forEach((button) => button.setAttribute("aria-pressed", String(!query && button.dataset.settingsView === selectedView)));
    clear.hidden = !query;
    document.getElementById("settings-search-results").textContent = query ? `${matches} matching sections · all categories` : "";
    empty.hidden = matches !== 0;
    if (!matches) WorkspaceUI.state(empty, { title: "No matching setting", message: "Try a shorter name, such as print, bag or backup.", action: "Clear search", onAction: clearSearch });
  }
  function clearSearch() { search.value = ""; render(); search.focus(); }
  const selectView = (view) => {
    selectedView = view;
    search.value = "";
    render();
  };
  search.addEventListener("input", render);
  clear.addEventListener("click", clearSearch);
  buttons.forEach((button) => button.addEventListener("click", () => selectView(button.dataset.settingsView)));
  selectView("billing");
});
