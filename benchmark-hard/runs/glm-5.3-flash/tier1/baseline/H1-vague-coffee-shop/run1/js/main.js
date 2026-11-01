/* ============================================================
   The Copper Cup — page behaviour
   1. Sticky header shadow
   2. Mobile navigation toggle
   3. Menu category tabs (click + keyboard, ARIA)
   4. Open / closed status computed from the visitor's clock
   5. "Today" highlight in the hours table
   6. Reveal-on-scroll (motion-safe, JS-guarded)
   7. Contact form validation (front-end demo — no backend)
   8. Footer year
   ============================================================ */

(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;

  /* ---------- 1. Header shadow on scroll ---------- */

  var header = doc.querySelector('.site-header');
  if (header) {
    var onScroll = function () {
      header.classList.toggle('scrolled', window.scrollY > 8);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- 2. Mobile navigation ---------- */

  var navToggle = doc.querySelector('.nav-toggle');
  var navLinks = doc.getElementById('nav-links');

  function closeNav() {
    doc.body.classList.remove('nav-open');
    if (navToggle) navToggle.setAttribute('aria-expanded', 'false');
  }

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', function () {
      var open = doc.body.classList.toggle('nav-open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    navLinks.addEventListener('click', function (event) {
      if (event.target.closest('a')) closeNav();
    });

    doc.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && doc.body.classList.contains('nav-open')) {
        closeNav();
        navToggle.focus();
      }
    });
  }

  /* ---------- 3. Menu tabs ---------- */

  var tablist = doc.querySelector('[role="tablist"]');
  var tabs = tablist ? Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]')) : [];
  var grid = doc.getElementById('menu-grid');
  var status = doc.getElementById('menu-status');
  var items = grid ? Array.prototype.slice.call(grid.querySelectorAll('.menu-item')) : [];

  function selectTab(tab) {
    var category = tab.dataset.category;

    tabs.forEach(function (t) {
      var selected = t === tab;
      t.setAttribute('aria-selected', selected ? 'true' : 'false');
      t.tabIndex = selected ? 0 : -1;
    });

    grid.setAttribute('aria-labelledby', tab.id);

    var shown = 0;
    items.forEach(function (item) {
      var match = category === 'all' || item.dataset.category === category;
      item.hidden = !match;
      if (match) shown += 1;
    });

    if (status) {
      status.textContent = 'Showing ' + shown + ' of ' + items.length + ' menu items.';
    }
  }

  if (tablist && tabs.length && grid) {
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () { selectTab(tab); });
    });

    tablist.addEventListener('keydown', function (event) {
      var current = tabs.indexOf(doc.activeElement);
      if (current === -1) return;

      var next = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % tabs.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;

      if (next !== null) {
        event.preventDefault();
        tabs[next].focus();
        selectTab(tabs[next]);
      }
    });
  }

  /* ---------- 4 & 5. Hours: open/closed note + today row ----------
     Minutes since midnight. Sunday = 0. Kept in one place; the visible
     table in index.html is the human-readable copy of the same data. */

  var HOURS = {
    0: [480, 960],   // Sunday     8 am - 4 pm
    1: [420, 1080],  // Monday     7 am - 6 pm
    2: [420, 1080],
    3: [420, 1080],
    4: [420, 1080],
    5: [420, 1080],
    6: [480, 960]    // Saturday   8 am - 4 pm
  };

  function fmtTime(totalMinutes) {
    var h24 = Math.floor(totalMinutes / 60);
    var m = totalMinutes % 60;
    var suffix = h24 >= 12 ? 'pm' : 'am';
    var h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return h12 + ':' + (m < 10 ? '0' + m : m) + ' ' + suffix;
  }

  var now = new Date();
  var today = now.getDay();
  var minutesNow = now.getHours() * 60 + now.getMinutes();
  var todayHours = HOURS[today];

  var noteWrap = doc.getElementById('open-note-wrap');
  var noteText = doc.getElementById('open-note');

  if (noteWrap && noteText && todayHours) {
    var opens = todayHours[0];
    var closes = todayHours[1];
    if (minutesNow >= opens && minutesNow < closes) {
      noteText.textContent = 'Open now \u00b7 closes ' + fmtTime(closes);
    } else {
      noteWrap.classList.add('closed');
      noteText.textContent = 'Closed right now \u00b7 full hours below';
    }
  }

  var todayRow = doc.querySelector('.hours-table tr[data-day="' + today + '"]');
  if (todayRow) todayRow.classList.add('today');

  /* ---------- 6. Reveal on scroll ----------
     The "reveal-ready" class is added by JS immediately before observing,
     so content is never hidden if this script fails to load. */

  root.classList.add('reveal-ready');

  var revealEls = Array.prototype.slice.call(doc.querySelectorAll('.reveal'));
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealEls.forEach(function (el) { el.classList.add('is-visible'); });
  } else {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });

    revealEls.forEach(function (el) { observer.observe(el); });
  }

  /* ---------- 7. Contact form (front-end demo) ---------- */

  var form = doc.getElementById('contact-form');
  var success = doc.getElementById('form-success');

  function setError(input, errorEl, hasError) {
    var field = input.closest('.field');
    if (field) field.classList.toggle('has-error', hasError);
    if (errorEl) errorEl.hidden = !hasError;
    input.setAttribute('aria-invalid', hasError ? 'true' : 'false');
  }

  if (form && success) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();

      var name = doc.getElementById('cf-name');
      var email = doc.getElementById('cf-email');
      var message = doc.getElementById('cf-message');
      var emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      var firstInvalid = null;

      var nameBad = name.value.trim() === '';
      setError(name, doc.getElementById('err-name'), nameBad);
      if (nameBad) firstInvalid = firstInvalid || name;

      var emailBad = !emailPattern.test(email.value.trim());
      setError(email, doc.getElementById('err-email'), emailBad);
      if (emailBad) firstInvalid = firstInvalid || email;

      var messageBad = message.value.trim() === '';
      setError(message, doc.getElementById('err-message'), messageBad);
      if (messageBad) firstInvalid = firstInvalid || message;

      if (firstInvalid) {
        firstInvalid.focus();
        return;
      }

      // No backend here: show the confirmation and stop.
      var firstName = name.value.trim().split(/\s+/)[0];
      success.querySelector('h4').textContent = 'Got it, ' + firstName + ' \u2014 thanks!';
      form.hidden = true;
      success.hidden = false;
      success.focus();
    });
  }

  /* ---------- 8. Footer year ---------- */

  var year = doc.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
