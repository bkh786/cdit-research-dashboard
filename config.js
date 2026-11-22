// Platform configuration (public — contains no secrets).
//
// masterUrl = the /exec URL of the master bridge script (bound to the "set-up-master" sheet).
// Leave it empty to run in personal mode (no login; settings stay in this browser).
// An administrator can also point a browser at the platform once with:  https://<your-site>/?master=<exec-url>
window.BRI_CONFIG = {
  masterUrl: "https://script.google.com/macros/s/AKfycby6mF5999P9id9QVrTznjcffcEBQee4PxEsHKeJBiMxAleM52jM6aFX7YSlEWJc8mwi/exec",
};
