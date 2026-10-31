/* ==========================================================================
   The Copper Cup — site behaviour
   Vanilla JS, no dependencies. Every block below is guarded so the script
   can safely load on every page and simply do nothing where a feature
   does not exist.
   ========================================================================== */

(function () {
  "use strict";

  // If the tiny inline head script did not run for some reason, make sure
  // the "js" class is present so reveal-on-scroll CSS applies predictably.
  document.documentElement.classList.remove("no-js");
  document.documentElement.classList.add("js");

  /* 1. Mobile navigation toggle
     ------------------------------------------------------------------ */

  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");

  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });

    // Close the panel after following any link inside it.
    nav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* 2. Footer year
     ------------------------------------------------------------------ */

  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  /* 3. Reveal-on-scroll
     ------------------------------------------------------------------ */

  var revealEls = document.querySelectorAll(".reveal");
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!("IntersectionObserver" in window) || reducedMotion) {
    revealEls.forEach(function (el) {
      el.classList.add("in");
    });
  } else {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    revealEls.forEach(function (el) {
      io.observe(el);
    });
  }

  /* 4. Menu dietary filters (menu.html)
     ------------------------------------------------------------------ */

  var chips = Array.prototype.slice.call(
    document.querySelectorAll(".menu-filters .chip")
  );

  if (chips.length) {
    var sections = Array.prototype.slice.call(
      document.querySelectorAll(".menu-section")
    );

    var applyFilter = function (filter) {
      sections.forEach(function (section) {
        var items = Array.prototype.slice.call(
          section.querySelectorAll(".menu-item")
        );
        var visible = 0;
        items.forEach(function (item) {
          var tags = (item.getAttribute("data-tags") || "").split(/\s+/);
          var show = filter === "all" || tags.indexOf(filter) !== -1;
          item.classList.toggle("is-hidden", !show);
          if (show) visible += 1;
        });
        section.classList.toggle("is-hidden", visible === 0);
      });
    };

    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        chips.forEach(function (c) {
          var on = c === chip;
          c.classList.toggle("is-active", on);
          c.setAttribute("aria-pressed", String(on));
        });
        applyFilter(chip.getAttribute("data-filter"));
      });
    });
  }

  /* 5. Contact form (visit.html) — client-side validation only.
     The form does not send anything anywhere yet; see the note on the page.
     ------------------------------------------------------------------ */

  var form = document.getElementById("contact-form");

  if (form) {
    var success = document.getElementById("form-success");

    var setErr = function (id, msg) {
      var field = document.getElementById(id);
      var err = document.getElementById(id + "-error");
      if (err) err.textContent = msg;
      if (field) field.setAttribute("aria-invalid", msg ? "true" : "false");
    };

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var checks = [
        ["cf-name", function (v) {
          return v.trim().length >= 2 || "Please tell us your name.";
        }],
        ["cf-email", function (v) {
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ||
            "That email address does not look right.";
        }],
        ["cf-message", function (v) {
          return v.trim().length >= 10 || "Give us a sentence or two (at least 10 characters).";
        }]
      ];

      var firstBad = null;
      checks.forEach(function (pair) {
        var el = document.getElementById(pair[0]);
        var result = pair[1](el.value);
        setErr(pair[0], result === true ? "" : result);
        if (result !== true && !firstBad) firstBad = el;
      });

      if (firstBad) {
        firstBad.focus();
        return;
      }

      form.hidden = true;
      success.hidden = false;
      success.focus();
    });
  }
})();
