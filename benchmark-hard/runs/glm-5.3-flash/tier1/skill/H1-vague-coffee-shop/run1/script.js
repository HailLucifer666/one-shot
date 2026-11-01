/* Ember & Oak — behaviour: mobile nav, menu category filter.
   The owner sheet specifies contact by mailto only, so there is no form.
   Pure logic is exported for Node tests; DOM code only runs in a browser. */
(function () {
  'use strict';

  /* ---- pure logic (tested in one-shot-work/behaviour.test.js) ---- */

  function matchesFilter(category, filter) {
    return filter === 'all' || category === filter;
  }

  // Node test hook (browser skips: module is undefined there)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { matchesFilter: matchesFilter };
  }

  /* ---- browser wiring ---- */

  if (typeof document === 'undefined') {
    return; // loaded by Node tests; nothing further to do
  }

  // Mobile nav toggle
  var nav = document.querySelector('.site-nav');
  var toggle = document.querySelector('.nav-toggle');
  if (nav && toggle) {
    var closeNav = function () {
      nav.classList.remove('nav-open');
      toggle.setAttribute('aria-expanded', 'false');
    };
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    nav.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('nav-open')) {
        closeNav();
        toggle.focus();
      }
    });
    document.querySelectorAll('.nav-links a').forEach(function (link) {
      link.addEventListener('click', closeNav);
    });
  }

  // Menu category filter
  var filterButtons = document.querySelectorAll('.filter-btn');
  var menuItems = document.querySelectorAll('.menu-item');
  var emptyNote = document.querySelector('.menu-empty');
  if (filterButtons.length && menuItems.length) {
    filterButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var filter = btn.getAttribute('data-filter');
        filterButtons.forEach(function (other) {
          other.setAttribute('aria-pressed', String(other === btn));
        });
        var visible = 0;
        menuItems.forEach(function (item) {
          var show = matchesFilter(item.getAttribute('data-category'), filter);
          item.hidden = !show;
          if (show) visible += 1;
        });
        if (emptyNote) emptyNote.hidden = visible > 0;
      });
    });
  }
})();
