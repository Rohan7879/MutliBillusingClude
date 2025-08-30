// --- FINAL AND CORRECT LOADING BAR FUNCTIONS ---
function showLoading() {
  const loadingBar = document.getElementById("loading-bar");
  if (loadingBar) {
    loadingBar.classList.remove("hidden");
    setTimeout(() => {
      loadingBar.classList.add("active");
    }, 10);
  }
}
function hideLoading() {
  const loadingBar = document.getElementById("loading-bar");
  if (loadingBar) {
    loadingBar.classList.remove("active");
    setTimeout(() => {
      loadingBar.classList.add("hidden");
    }, 1500);
  }
}
function formatNumber(num) {
  if (isNaN(num) || num === "") {
    return num;
  }
  const numString = Number(num).toLocaleString("en-IN");

  if (numString.length > 10) {
    // Return a smaller font size for large numbers
    return `<span class="large-number">${numString}</span>`;
  }
  return numString;
}
function customRound(num) {
  let decimal = num - Math.floor(num);
  return decimal > 0.5 ? Math.ceil(num) : Math.floor(num);
}
