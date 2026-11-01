/* ==========================================================================
   Ember & Oak — site behaviour
   1. Open/closed badge (from the HOURS table below)
   2. Mobile navigation
   3. Active nav link while scrolling
   4. Reveal-on-scroll
   5. Contact form (front-end demo only)
   ========================================================================== */

(function () {
  "use strict";

  /* ---------- 1. Open/closed badge ----------
     Opening hours, 24h clock. Index = Date.getDay(): 0 = Sunday … 6 = Saturday.
     KEEP THIS IN SYNC WITH THE HOURS TABLE IN THE "HOURS & LOCATION" SECTION of index.html. */
  var HOURS = [
    [8, 16], // Sunday
    [7, 18], // Monday
    [7, 18], // Tuesday
    [7, 18], // Wednesday
    [7, 18], // Thursday
    [7, 18], // Friday
    [8, 16]  // Saturday
  ];

  function fmt(h) {
    var period = h < 12 ? "am" : "pm";
    var hour = h % 12 === 0 ? 12 : h % 12;
    return hour + ":00 " + period;
  }

  function openStatus() {
    var now = new Date();
    var day = now.getDay();
    var mins = now.getHours() * 60 + now.getMinutes();
    var today = HOURS[day];
    var openMins = today[0] * 60;
    var closeMins = today[1] * 60;

    if (mins >= openMins && mins < closeMins) {
      return { open: true, text: "Open now · closes " + fmt(today[1]) };
    }
    if (mins < openMins) {
      return { open: false, text: "Closed · opens today at " + fmt(today[0]) };
    }
    var tomorrow = HOURS[(day + 1) % 7];
    return { open: false, text: "Closed · opens tomorrow at " + fmt(tomorrow[0]) };
  }

  var badges = Array.prototype.slice.call(document.querySelectorAll(".js-open-badge"));

  function renderBadges() {
    if (!badges.length) return;
    var s = openStatus();
    badges.forEach(function (badge) {
      badge.textContent = s.text;
      badge.classList.toggle("is-open", s.open);
      badge.classList.toggle("is-closed", !s.open);
    });
  }

  renderBadges();
  setInterval(renderBadges, 60000);

  /* ---------- 2. Mobile navigation ---------- */

  var header = document.querySelector(".site-header");
  var navToggle = document.getElementById("navToggle");
  var siteNav = document.getElementById("siteNav");

  function closeNav(refocus) {
    if (!header || !navToggle) return;
    header.classList.remove("nav-open");
    navToggle.setAttribute("aria-expanded", "false");
    if (refocus) navToggle.focus();
  }

  if (header && navToggle && siteNav) {
    navToggle.addEventListener("click", function () {
      var isOpen = header.classList.toggle("nav-open");
      navToggle.setAttribute("aria-expanded", String(isOpen));
    });

    siteNav.addEventListener("click", function (e) {
      if (e.target.closest("a")) closeNav(false);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && header.classList.contains("nav-open")) closeNav(true);
    });
  }

  /* ---------- 3. Active nav link while scrolling ---------- */

  var navLinks = Array.prototype.slice.call(document.querySelectorAll(".site-nav a[href^='#']"));
  var linkById = {};
  navLinks.forEach(function (link) {
    var id = link.getAttribute("href").slice(1);
    linkById[id] = link;
  });
  var watchedSections = navLinks
    .map(function (link) { return link.getAttribute("href").slice(1); })
    .map(function (id) { return document.getElementById(id); })
    .filter(Boolean);

  if ("IntersectionObserver" in window && watchedSections.length) {
    var sectionObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          navLinks.forEach(function (link) { link.classList.remove("active"); });
          var link = linkById[entry.target.id];
          if (link) link.classList.add("active");
        });
      },
      { rootMargin: "-45% 0px -50% 0px", threshold: 0 }
    );
    watchedSections.forEach(function (section) { sectionObserver.observe(section); });
  }

  /* ---------- 4. Reveal on scroll ---------- */

  var revealEls = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach(function (el) { el.classList.add("in"); });
  } else {
    var revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    revealEls.forEach(function (el) { revealObserver.observe(el); });
  }

  /* ---------- 5. Contact form (front-end demo) ---------- */

  var form = document.getElementById("contactForm");
  var success = document.getElementById("formSuccess");
  var successName = document.getElementById("successName");
  var formReset = document.getElementById("formReset");

  if (form && success) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      var nameField = form.querySelector("#cf-name");
      var name = nameField && nameField.value.trim() ? nameField.value.trim().split(/\s+/)[0] : "friend";
      if (successName) successName.textContent = name;
      form.hidden = true;
      success.hidden = false;
      success.querySelector("h3").setAttribute("tabindex", "-1");
      success.querySelector("h3").focus();
    });
  }

  if (formReset && form && success) {
    formReset.addEventListener("click", function () {
      success.hidden = true;
      form.hidden = false;
      form.reset();
      var nameField = form.querySelector("#cf-name");
      if (nameField) nameField.focus();
    });
  }

  /* ---------- Footer year ---------- */

  var year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());
})();
