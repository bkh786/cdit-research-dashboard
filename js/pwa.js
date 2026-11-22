/* Installable app (PWA): registers the service worker and shows an Install button until the app is installed. */
"use strict";
(() => {
  const standalone = () => matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: window-controls-overlay)").matches || navigator.standalone === true;
  let deferred = null, btn = null;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  function mount() {
    if (btn || standalone()) return;
    const host = document.querySelector(".tb-right"); if (!host) return;
    btn = document.createElement("button");
    btn.className = "btn sm install-btn"; btn.id = "installBtn"; btn.title = "Install this app on your device";
    btn.innerHTML = `${typeof ic === "function" ? ic("download", 14) : ""}<span>Install app</span>`;
    btn.addEventListener("click", install);
    host.insertBefore(btn, host.firstChild);
  }
  const unmount = () => { if (btn) { btn.remove(); btn = null; } };

  async function install() {
    if (deferred) {
      deferred.prompt();
      const { outcome } = await deferred.userChoice.catch(() => ({}));
      deferred = null; if (outcome === "accepted") unmount();
      return;
    }
    const msg = ios ? "On iPhone/iPad: tap the Share button in Safari, then “Add to Home Screen”."
      : "Use your browser menu → “Install app” / “Add to Home screen” (in Chrome or Edge, look for the install icon in the address bar).";
    if (typeof toast === "function") toast(msg, "info", 9000); else alert(msg);
  }

  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; mount(); });
  addEventListener("appinstalled", () => { deferred = null; unmount(); if (typeof toast === "function") toast("App installed", "ok"); });
  matchMedia("(display-mode: standalone)").addEventListener && matchMedia("(display-mode: standalone)").addEventListener("change", (e) => { if (e.matches) unmount(); });

  addEventListener("load", () => {
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register("sw.js").catch(() => {});
    setTimeout(mount, 600); // browsers without the install event (Safari, Firefox) still get the button, with instructions
  });
})();
