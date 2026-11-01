// Progressive enhancement only: the site is fully usable without this file.
// The CSS-only checkbox menu, smooth scrolling (CSS scroll-behavior) and all
// content work with JavaScript disabled.
(() => {
  'use strict';

  // Close the mobile menu after a link is chosen (the checkbox stays open
  // otherwise, covering the page on small screens).
  const toggle = document.getElementById('nav-toggle');
  if (toggle) {
    document.querySelectorAll('.site-nav a').forEach((link) => {
      link.addEventListener('click', () => {
        toggle.checked = false;
      });
    });
  }

  // Reveal-on-scroll. Hidden styles only apply under html.js, and only when
  // the browser supports IntersectionObserver and motion is allowed.
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if ('IntersectionObserver' in window && !reducedMotion) {
    const targets = document.querySelectorAll('.hero-copy, .about-grid, .menu-group, .visit-card');
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px' }
    );
    targets.forEach((el) => {
      el.classList.add('reveal');
      io.observe(el);
    });
  }

  // Keep the footer copyright year current.
  const year = document.getElementById('year');
  if (year) {
    year.textContent = String(new Date().getFullYear());
  }
})();
