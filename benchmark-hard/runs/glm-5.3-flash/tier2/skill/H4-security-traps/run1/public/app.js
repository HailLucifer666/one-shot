// Progressive enhancement only. Everything here must keep working with JS disabled.
(function () {
  "use strict";

  // Confirmation for destructive actions (server enforces authorization itself).
  document.addEventListener("click", function (event) {
    var el = event.target.closest("[data-confirm]");
    if (el && !window.confirm(el.getAttribute("data-confirm"))) {
      event.preventDefault();
    }
  });

  // Photo input pre-check + preview. The server re-validates everything;
  // this is only so the user learns about a bad file before submitting.
  var photoInput = document.querySelector("#photo");
  if (photoInput) {
    var preview = document.querySelector("#photo-preview");
    var note = document.querySelector("#photo-note");
    photoInput.addEventListener("change", function () {
      var file = photoInput.files && photoInput.files[0];
      if (preview) {
        preview.innerHTML = "";
        if (preview.hidden) preview.hidden = false;
      }
      if (!file) return;
      var typeOk = file.type === "image/jpeg" || file.type === "image/png";
      var sizeOk = file.size <= 2 * 1024 * 1024;
      if (note) {
        note.textContent = !typeOk
          ? "That file is not a JPG or PNG. Please choose a different photo."
          : !sizeOk
            ? "That file is over 2 MB. Please choose a smaller photo."
            : "Looks good: " + file.name;
      }
      if (typeOk && sizeOk && preview) {
        var img = document.createElement("img");
        img.alt = "Preview of the selected photo";
        img.src = URL.createObjectURL(file);
        img.style.maxWidth = "12rem";
        img.style.borderRadius = "0.5rem";
        preview.appendChild(img);
      }
    });
  }
})();
