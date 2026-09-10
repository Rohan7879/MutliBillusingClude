// PWA install support. Loaded on login and injected by firebase-init on every
// app page so Android Chrome can recognise MandiBook as an installable app.
(() => {
  const manifestHref = new URL("manifest.webmanifest", window.location.href).href;
  if (!document.querySelector('link[rel="manifest"]')) {
    const manifest = document.createElement("link");
    manifest.rel = "manifest";
    manifest.href = manifestHref;
    document.head.appendChild(manifest);
  }
  if (!document.querySelector('meta[name="theme-color"]')) {
    const theme = document.createElement("meta");
    theme.name = "theme-color";
    theme.content = "#005a9e";
    document.head.appendChild(theme);
  }
  if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
    const appleCapable = document.createElement("meta");
    appleCapable.name = "apple-mobile-web-app-capable";
    appleCapable.content = "yes";
    document.head.appendChild(appleCapable);
  }

  let deferredInstallPrompt = null;
  const installButton = document.getElementById("install-app-btn");
  const setInstallVisibility = (visible) => {
    if (installButton) installButton.hidden = !visible;
  };

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    setInstallVisibility(true);
  });

  installButton?.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    setInstallVisibility(false);
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    setInstallVisibility(false);
  });

  if ("serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((error) => console.warn("PWA service worker unavailable:", error));
    });
  }
})();
