// PWA install support. Include this on app entry and workspace pages so
// installed clients check for a new worker without having to revisit login.
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
    const syncWorker = async () => {
      try {
        const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
        if (isLocal) {
          // Live Server serves source files. An installed worker from a prior
          // preview must not replace those files with an older cached version.
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.filter((registration) => {
            const worker = registration.active || registration.waiting || registration.installing;
            return worker && new URL(worker.scriptURL).pathname === "/sw.js";
          }).map((registration) => registration.unregister()));
          return;
        }
        const registration = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
        await registration.update();
      } catch (error) {
        console.warn("PWA service worker unavailable:", error);
      }
    };
    if (document.readyState === "complete") syncWorker();
    else window.addEventListener("load", syncWorker, { once: true });
  }
})();
