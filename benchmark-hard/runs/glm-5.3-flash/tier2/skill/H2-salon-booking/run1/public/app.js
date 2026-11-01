/*
 * Progressive enhancement only — every flow works without this script.
 * Shows a busy state on form submit (the app's "loading" state for
 * server-rendered forms) and restores it when the page is restored
 * from the back/forward cache.
 */
(function () {
  "use strict";

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement) || form.hasAttribute("data-no-busy")) return;
    var button = form.querySelector('button[type="submit"]');
    if (button && !button.disabled) {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
      button.textContent = "Working\u2026";
    }
  });

  window.addEventListener("pageshow", function () {
    document.querySelectorAll('button[aria-busy="true"]').forEach(function (button) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      if (button.dataset.originalText) button.textContent = button.dataset.originalText;
    });
  });
})();
