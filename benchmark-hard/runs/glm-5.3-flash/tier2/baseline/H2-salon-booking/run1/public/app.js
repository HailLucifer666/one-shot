/* Cutwell Salon booking app (vanilla JS, no build step).
   Keyboard friendly: everything is real buttons/links/inputs, focus is moved
   to the first slot after a search, and all states are announced politely. */

(function () {
  'use strict';

  // ---------- tiny helpers ----------

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function api(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = { error: text }; }
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  let toastTimer = null;
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
  }

  function showError(id, message) {
    const el = $(id);
    el.textContent = message;
    el.hidden = false;
  }
  function clearError(id) {
    const el = $(id);
    el.textContent = '';
    el.hidden = true;
  }

  /** Empty / loading / error / ready states for every list region. */
  function renderState(el, kind, message) {
    if (kind === 'loading') {
      el.innerHTML = `<p class="state state-loading" role="status">${esc(message || 'Loading...')}</p>`;
    } else if (kind === 'empty') {
      el.innerHTML = `<p class="state state-empty">${esc(message || 'Nothing here yet.')}</p>`;
    } else if (kind === 'error') {
      el.innerHTML = `<p class="state state-error" role="alert">${esc(message || 'Something went wrong.')}</p>`;
    }
  }

  function busy(btn, isBusy, busyLabel) {
    if (isBusy) {
      btn.dataset.label = btn.textContent;
      btn.textContent = busyLabel || 'Working...';
      btn.disabled = true;
    } else {
      btn.textContent = btn.dataset.label || btn.textContent;
      btn.disabled = false;
    }
  }

  // ---------- state ----------

  const state = {
    user: null,
    meta: null,
    services: [],
    stylists: [],
    myBookings: [],
    booking: { serviceId: null, stylistId: 'any', date: '', start: null },
    reschedule: { ref: null, serviceId: null, stylistId: null, start: null },
    admin: { page: 1, date: '', stylistId: '', status: '' },
  };

  const isCustomer = () => state.user && state.user.role === 'customer';
  const isAdmin = () => state.user && state.user.role === 'admin';
  const isStylist = () => state.user && state.user.role === 'stylist';

  // ---------- navigation ----------

  const VIEWS = {
    book: { el: '#view-book', roles: ['customer'] },
    bookings: { el: '#view-bookings', roles: ['customer'] },
    schedule: { el: '#view-schedule', roles: ['stylist'] },
    admin: { el: '#view-admin', roles: ['admin'] },
    audit: { el: '#view-audit', roles: ['admin'] },
  };

  function currentRoute() {
    const hash = location.hash.replace(/^#\/?/, '') || '';
    return hash.split('?')[0];
  }

  function navigate() {
    const route = currentRoute();
    $$('.view').forEach((v) => { v.hidden = true; });

    if (!state.user) {
      $('#view-auth').hidden = false;
      return;
    }
    const view = VIEWS[route];
    if (!view || !view.roles.includes(state.user.role)) {
      // Send the user to their home view.
      const home = isAdmin() ? 'admin' : isStylist() ? 'schedule' : 'book';
      if (route) { location.hash = '#/' + home; return; }
      $('#view-' + home).hidden = false;
      if (home === 'book') loadBookView();
      if (home === 'schedule') loadSchedule();
      if (home === 'admin') loadAdmin();
      return;
    }

    $(view.el).hidden = false;
    $$('.site-nav a').forEach((a) => {
      if (a.dataset.nav === route) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    if (route === 'book') loadBookView();
    if (route === 'bookings') loadMyBookings();
    if (route === 'schedule') loadSchedule();
    if (route === 'admin') loadAdmin();
    if (route === 'audit') loadAudit();
  }

  function renderNav() {
    const defs = [
      ['book', isCustomer()],
      ['bookings', isCustomer()],
      ['schedule', isStylist()],
      ['admin', isAdmin()],
      ['audit', isAdmin()],
    ];
    for (const [name, visible] of defs) {
      const a = document.querySelector(`.site-nav a[data-nav="${name}"]`);
      if (a) a.hidden = !visible;
    }
    $('#btn-logout').hidden = !state.user;
    const navUser = $('#nav-user');
    if (state.user) {
      navUser.hidden = false;
      navUser.textContent = `${state.user.name} (${state.user.role})`;
    } else {
      navUser.hidden = true;
      navUser.textContent = '';
    }
  }

  // ---------- auth ----------

  async function doLogin(email, password, btn) {
    clearError('#login-error');
    busy(btn, true, 'Signing in...');
    try {
      const data = await api('POST', '/api/auth/login', { email, password });
      state.user = data.user;
      await bootData();
      renderNav();
      navigate();
    } catch (err) {
      showError('#login-error', err.message);
    } finally {
      busy(btn, false);
    }
  }

  async function doRegister(name, email, password, btn) {
    clearError('#register-error');
    busy(btn, true, 'Creating account...');
    try {
      const data = await api('POST', '/api/auth/register', { name, email, password });
      state.user = data.user;
      await bootData();
      renderNav();
      navigate();
      toast('Welcome to Cutwell, ' + data.user.name + '!');
    } catch (err) {
      showError('#register-error', err.message);
    } finally {
      busy(btn, false);
    }
  }

  async function doLogout() {
    try { await api('POST', '/api/auth/logout'); } catch { /* ignore */ }
    state.user = null;
    state.booking = { serviceId: null, stylistId: 'any', date: '', start: null };
    renderNav();
    location.hash = '';
    navigate();
  }

  // ---------- catalog loading ----------

  async function bootData() {
    const requests = [
      api('GET', '/api/meta'),
      api('GET', '/api/services'),
      api('GET', '/api/stylists'),
    ];
    const [meta, services, stylists] = await Promise.all(requests);
    state.meta = meta;
    state.services = services.services;
    state.stylists = stylists.stylists;
    $('#clock-note').hidden = !meta.clock_override;
    if (meta.clock_override) $('#clock-value').textContent = meta.now_utc;
    $('#footer-tz').textContent = meta.salon_timezone;
  }

  function renderServiceRadios() {
    const box = $('#service-list');
    if (!state.services.length) {
      renderState(box, 'empty', 'No services are configured.');
      return;
    }
    box.innerHTML = state.services
      .map(
        (s, i) => `
        <label>
          <input type="radio" name="service" value="${s.id}" ${i === 0 ? 'checked' : ''}>
          <span><strong>${esc(s.name)}</strong> <span class="muted small">${s.duration_minutes} min</span></span>
          <span class="price">${esc(s.price_display)}</span>
        </label>`
      )
      .join('');
    state.booking.serviceId = state.services[0].id;
    box.addEventListener('change', (e) => {
      if (e.target.name === 'service') {
        state.booking.serviceId = Number.parseInt(e.target.value, 10);
        state.booking.start = null;
        $('#confirm-card').hidden = true;
      }
    });
  }

  function renderStylistSelect() {
    const sel = $('#stylist-select');
    sel.innerHTML =
      '<option value="any">Any available stylist</option>' +
      state.stylists
        .map((s) => `<option value="${s.id}">${esc(s.name)}</option>`)
        .join('');
    $('#stylist-schedules').textContent =
      'Schedules: ' + state.stylists.map((s) => `${s.name} - ${s.schedule_text}`).join(' | ');
    const filterSel = $('#filter-stylist');
    if (filterSel && filterSel.options.length <= 1) {
      filterSel.innerHTML =
        '<option value="">All stylists</option>' +
        state.stylists.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    }
  }

  function boundsForDate(input) {
    if (!state.meta) return;
    input.min = state.meta.min_date;
    input.max = state.meta.max_date;
  }

  // ---------- booking flow ----------

  async function findSlots(region, serviceId, stylistId, date, onPick) {
    region.innerHTML = '';
    renderState(region, 'loading', 'Checking availability...');
    try {
      const data = await api(
        'GET',
        `/api/availability?serviceId=${encodeURIComponent(serviceId)}&stylistId=${encodeURIComponent(stylistId)}&date=${encodeURIComponent(date)}`
      );
      if (!data.slots.length) {
        renderState(
          region,
          'empty',
          'No available times on this date. The salon is closed on Sundays; stylists have their own working hours. Try another date.'
        );
        return;
      }
      const grid = document.createElement('div');
      grid.className = 'slot-grid';
      for (const slot of data.slots) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'slot-btn';
        btn.textContent = slot.label;
        btn.dataset.start = slot.start_utc;
        btn.setAttribute('aria-pressed', 'false');
        btn.addEventListener('click', () => {
          region.querySelectorAll('.slot-btn').forEach((b) => b.setAttribute('aria-pressed', 'false'));
          btn.setAttribute('aria-pressed', 'true');
          onPick(slot);
        });
        grid.appendChild(btn);
      }
      region.innerHTML = '';
      region.appendChild(grid);
      const first = grid.querySelector('.slot-btn');
      if (first) first.focus();
    } catch (err) {
      renderState(region, 'error', err.message);
    }
  }

  function loadBookView() {
    if (!state.services.length) return;
    if (!$('#service-list input')) renderServiceRadios();
    renderStylistSelect();
    boundsForDate($('#book-date'));
    boundsForDate($('#reschedule-date'));
    boundsForDate($('#filter-date'));
  }

  async function confirmBooking(btn) {
    clearError('#book-error');
    const b = state.booking;
    if (!b.serviceId || !b.start) {
      showError('#book-error', 'Pick a date and a time first.');
      return;
    }
    busy(btn, true, 'Booking...');
    try {
      const data = await api('POST', '/api/bookings', {
        serviceId: b.serviceId,
        stylistId: b.stylistId,
        start: b.start,
      });
      $('#confirm-card').hidden = true;
      const bk = data.booking;
      $('#booked-panel').hidden = false;
      $('#booked-detail').innerHTML =
        `Reference <strong class="mono">${esc(bk.ref)}</strong> - ` +
        `${esc(bk.service.name)} with <strong>${esc(bk.stylist.name)}</strong><br>` +
        `${esc(bk.start_display)} - ${esc(bk.end_display)} (${esc(state.meta.salon_timezone)})`;
      $('#booked-panel').scrollIntoView({ block: 'nearest' });
      toast(`Booked ${bk.ref}`);
      state.booking.start = null;
    } catch (err) {
      showError('#book-error', err.message);
    } finally {
      busy(btn, false);
    }
  }

  // ---------- my bookings ----------

  async function loadMyBookings() {
    const list = $('#bookings-list');
    clearError('#bookings-error');
    renderState(list, 'loading');
    try {
      const data = await api('GET', '/api/bookings');
      state.myBookings = data.bookings;
      if (!data.bookings.length) {
        renderState(list, 'empty', 'You have no bookings yet. Book your first appointment!');
        return;
      }
      list.innerHTML = data.bookings.map(bookingCard).join('');
      list.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', (e) => onBookingAction(e.currentTarget, btn.dataset.ref));
      });
    } catch (err) {
      renderState(list, 'error', err.message);
    }
  }

  function bookingCard(bk) {
    const cancelled = bk.status === 'cancelled';
    return `
      <div class="card" data-ref="${esc(bk.ref)}">
        <div class="toolbar">
          <strong class="mono">${esc(bk.ref)}</strong>
          <span class="badge badge-${esc(bk.status)}">${esc(bk.status)}</span>
        </div>
        <p>
          <strong>${esc(bk.service.name)}</strong> (${bk.service.duration_minutes} min, ${esc(bk.service.price_display)})
          with <strong>${esc(bk.stylist.name)}</strong><br>
          ${esc(bk.start_display)} - ${esc(bk.end_display)}
        </p>
        ${cancelled && bk.cancel_reason ? `<p class="muted small">Reason: ${esc(bk.cancel_reason)}</p>` : ''}
        ${!cancelled ? `
          <div class="row-actions">
            <button type="button" class="btn btn-danger btn-mini" data-action="cancel" data-ref="${esc(bk.ref)}" ${bk.can_cancel ? '' : 'disabled'}>Cancel</button>
            <button type="button" class="btn btn-ghost btn-mini" data-action="reschedule" data-ref="${esc(bk.ref)}" ${bk.can_reschedule ? '' : 'disabled'}>Reschedule</button>
          </div>
          ${bk.can_cancel ? '' : '<p class="muted small">Cancellation and rescheduling close 24 hours before the start time. Please contact the salon.</p>'}
        ` : ''}
      </div>`;
  }

  async function onBookingAction(btn, ref) {
    const action = btn.dataset.action;
    if (action === 'cancel') {
      busy(btn, true, 'Cancelling...');
      try {
        await api('POST', `/api/bookings/${encodeURIComponent(ref)}/cancel`, {});
        toast(`Booking ${ref} cancelled. A cancellation notice was saved to the outbox.`);
        loadMyBookings();
      } catch (err) {
        showError('#bookings-error', err.message);
      } finally {
        busy(btn, false);
      }
      return;
    }
    if (action === 'reschedule') {
      openReschedule(ref);
    }
  }

  function openReschedule(ref) {
    const bk = state.myBookings.find((b) => b.ref === ref);
    if (!bk) return;
    state.reschedule = { ref, serviceId: bk.service_id, stylistId: bk.stylist_id, start: null };
    const card = $('#reschedule-card');
    card.hidden = false;
    $('#reschedule-ref').textContent = ref;
    $('#reschedule-slots').innerHTML = '<p class="muted">Pick a new date, then "Find times". The reference code stays the same.</p>';
    card.scrollIntoView({ block: 'nearest' });
  }

  async function confirmReschedule(btn) {
    clearError('#bookings-error');
    if (!state.reschedule.start) {
      $('#reschedule-slots').innerHTML = '<p class="state state-error" role="alert">Pick a new time first.</p>';
      return;
    }
    busy(btn, true, 'Rescheduling...');
    try {
      const data = await api('POST', `/api/bookings/${encodeURIComponent(state.reschedule.ref)}/reschedule`, {
        start: state.reschedule.start,
      });
      $('#reschedule-card').hidden = true;
      toast(`Booking ${data.booking.ref} moved to ${data.booking.start_display}.`);
      loadMyBookings();
    } catch (err) {
      showError('#bookings-error', err.message);
    } finally {
      busy(btn, false);
    }
  }

  // ---------- stylist schedule ----------

  async function loadSchedule() {
    const list = $('#schedule-list');
    clearError('#schedule-error');
    renderState(list, 'loading');
    try {
      const data = await api('GET', '/api/stylist/schedule');
      const mine = data.bookings.filter((b) => b.status === 'confirmed');
      const past = data.bookings.filter((b) => b.status === 'cancelled');
      if (!data.bookings.length) {
        renderState(list, 'empty', 'No appointments on your schedule yet.');
        return;
      }
      list.innerHTML =
        renderScheduleTable('Upcoming and today', mine) +
        (past.length ? renderScheduleTable('Cancelled', past) : '');
    } catch (err) {
      renderState(list, 'error', err.message);
    }
  }

  function renderScheduleTable(title, rows) {
    if (!rows.length) return '';
    const body = rows
      .map(
        (b) => `
        <tr>
          <td class="mono">${esc(b.ref)}</td>
          <td>${esc(b.start_local)}<br><span class="muted small">to ${esc(b.end_local)}</span></td>
          <td>${esc(b.service.name)}</td>
          <td>${esc(b.customer_email || '')}</td>
          <td><span class="badge badge-${esc(b.status)}">${esc(b.status)}</span></td>
        </tr>`
      )
      .join('');
    return `
      <h2 class="h-small">${esc(title)}</h2>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr><th scope="col">Ref</th><th scope="col">When (local)</th><th scope="col">Service</th><th scope="col">Customer</th><th scope="col">Status</th></tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  // ---------- admin ----------

  async function loadAdmin(page) {
    const box = $('#admin-table');
    clearError('#admin-error');
    renderState(box, 'loading');
    const a = state.admin;
    if (page) a.page = page;
    const params = new URLSearchParams();
    params.set('page', String(a.page));
    if (a.date) params.set('date', a.date);
    if (a.stylistId) params.set('stylistId', a.stylistId);
    if (a.status) params.set('status', a.status);
    try {
      const data = await api('GET', '/api/admin/bookings?' + params.toString());
      if (!data.bookings.length) {
        renderState(box, 'empty', 'No bookings match these filters.');
      } else {
        box.innerHTML = renderAdminTable(data.bookings);
        box.querySelectorAll('[data-action="admin-cancel"]').forEach((btn) => {
          btn.addEventListener('click', () => showAdminCancelForm(btn.dataset.ref));
        });
        box.querySelectorAll('[data-action="admin-cancel-confirm"]').forEach((btn) => {
          btn.addEventListener('click', () => adminCancel(btn));
        });
        box.querySelectorAll('[data-action="admin-cancel-close"]').forEach((btn) => {
          btn.addEventListener('click', () => loadAdmin());
        });
      }
      $('#admin-count').textContent = `${data.total} booking${data.total === 1 ? '' : 's'} found`;
      renderPager(data.page, data.total_pages);
    } catch (err) {
      renderState(box, 'error', err.message);
    }
  }

  function renderAdminTable(rows) {
    const body = rows
      .map(
        (b) => `
        <tr>
          <td class="mono">${esc(b.ref)}</td>
          <td>${esc(b.start_local)}<br><span class="muted small">to ${esc(b.end_local)}</span></td>
          <td>${esc(b.service.name)}</td>
          <td>${esc(b.stylist.name)}</td>
          <td>${esc(b.customer_email || '')}</td>
          <td><span class="badge badge-${esc(b.status)}">${esc(b.status)}</span>
            ${b.cancel_reason ? `<br><span class="muted small">${esc(b.cancel_reason)}</span>` : ''}</td>
          <td>
            ${b.status === 'confirmed' ? `
              <button type="button" class="btn btn-danger btn-mini" data-action="admin-cancel" data-ref="${esc(b.ref)}">Cancel</button>` : ''}
          </td>
        </tr>`
      )
      .join('');
    return `
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th scope="col">Ref</th><th scope="col">When (local)</th><th scope="col">Service</th>
              <th scope="col">Stylist</th><th scope="col">Customer</th><th scope="col">Status</th><th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  function showAdminCancelForm(ref) {
    // Inline form injected right after the clicked row.
    const btn = document.querySelector(`#admin-table button[data-ref="${ref}"][data-action="admin-cancel"]`);
    const tr = btn.closest('tr');
    tr.insertAdjacentHTML(
      'afterend',
      `<tr><td colspan="7">
        <div class="alert alert-error" role="alert">Admin cancellation - a written reason is required.</div>
        <div class="field">
          <label for="reason-${ref}">Reason for cancelling ${esc(ref)}</label>
          <input type="text" id="reason-${ref}" class="admin-reason" data-ref="${esc(ref)}" autocomplete="off">
        </div>
        <div class="row-actions">
          <button type="button" class="btn btn-danger btn-mini" data-action="admin-cancel-confirm" data-ref="${esc(ref)}">Confirm cancellation</button>
          <button type="button" class="btn btn-ghost btn-mini" data-action="admin-cancel-close">Keep booking</button>
        </div>
      </td></tr>`
    );
    const input = document.getElementById(`reason-${ref}`);
    if (input) input.focus();
  }

  async function adminCancel(btn) {
    const ref = btn.dataset.ref;
    const input = document.querySelector(`#admin-table input.admin-reason[data-ref="${ref}"]`);
    const reason = input ? input.value : '';
    busy(btn, true, 'Cancelling...');
    try {
      await api('POST', `/api/bookings/${encodeURIComponent(ref)}/cancel`, { reason });
      toast(`Booking ${ref} cancelled with reason.`);
      loadAdmin();
    } catch (err) {
      showError('#admin-error', err.message);
      busy(btn, false);
    }
  }

  function renderPager(page, totalPages) {
    const pager = $('#admin-pager');
    if (totalPages <= 1) {
      pager.innerHTML = '';
      return;
    }
    pager.innerHTML = `
      <button type="button" class="btn btn-ghost btn-mini" id="pager-prev" ${page <= 1 ? 'disabled' : ''}>Previous</button>
      <span class="muted">Page ${page} of ${totalPages}</span>
      <button type="button" class="btn btn-ghost btn-mini" id="pager-next" ${page >= totalPages ? 'disabled' : ''}>Next</button>`;
    $('#pager-prev').addEventListener('click', () => loadAdmin(page - 1));
    $('#pager-next').addEventListener('click', () => loadAdmin(page + 1));
  }

  // ---------- audit ----------

  async function loadAudit() {
    const list = $('#audit-list');
    clearError('#audit-error');
    renderState(list, 'loading');
    try {
      const data = await api('GET', '/api/admin/audit');
      if (!data.entries.length) {
        renderState(list, 'empty', 'No audit entries yet.');
        return;
      }
      const body = data.entries
        .map(
          (e) => `
          <tr>
            <td>${esc(e.at_local)}<br><span class="muted small">${esc(e.at_utc)}</span></td>
            <td>${esc(e.actor_email)}<br><span class="muted small">${esc(e.actor_role)}</span></td>
            <td><span class="badge badge-confirmed">${esc(e.action)}</span></td>
            <td class="mono">${esc(e.booking_ref)}</td>
            <td>
              <pre class="diff">before: ${esc(JSON.stringify(e.before))}</pre>
              <pre class="diff">after:  ${esc(JSON.stringify(e.after))}</pre>
            </td>
          </tr>`
        )
        .join('');
      list.innerHTML = `
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Booking</th><th scope="col">Before / after</th></tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>`;
    } catch (err) {
      renderState(list, 'error', err.message);
    }
  }

  // ---------- boot ----------

  function wireEvents() {
    $('#form-login').addEventListener('submit', (e) => {
      e.preventDefault();
      doLogin($('#login-email').value, $('#login-password').value, $('#login-submit'));
    });
    $('#form-register').addEventListener('submit', (e) => {
      e.preventDefault();
      doRegister($('#reg-name').value, $('#reg-email').value, $('#reg-password').value, $('#register-submit'));
    });
    $('#btn-logout').addEventListener('click', doLogout);

    $('#btn-find-slots').addEventListener('click', () => {
      const date = $('#book-date').value;
      if (!date) {
        $('#slots-region').innerHTML = '<p class="state state-error" role="alert">Pick a date first.</p>';
        return;
      }
      state.booking.date = date;
      state.booking.stylistId = $('#stylist-select').value;
      state.booking.start = null;
      $('#confirm-card').hidden = true;
      $('#booked-panel').hidden = true;
      findSlots($('#slots-region'), state.booking.serviceId, state.booking.stylistId, date, (slot) => {
        state.booking.start = slot.start_utc;
        const service = state.services.find((s) => s.id === state.booking.serviceId);
        const stylist = state.stylists.find((s) => String(s.id) === String(state.booking.stylistId));
        $('#confirm-summary').innerHTML =
          `<strong>${esc(service.name)}</strong> (${service.duration_minutes} min, ${esc(service.price_display)})<br>` +
          `Stylist: <strong>${stylist ? esc(stylist.name) : 'Any available stylist'}</strong><br>` +
          `Time: <strong>${esc(slot.label)}</strong> on ${esc(date)} (${esc(state.meta.salon_timezone)})`;
        $('#confirm-card').hidden = false;
        $('#btn-confirm-book').focus();
      });
    });

    $('#btn-confirm-book').addEventListener('click', (e) => confirmBooking(e.currentTarget));

    $('#btn-find-reschedule').addEventListener('click', () => {
      const date = $('#reschedule-date').value;
      if (!date) {
        $('#reschedule-slots').innerHTML = '<p class="state state-error" role="alert">Pick a new date first.</p>';
        return;
      }
      // Reschedule keeps the same service and stylist as the original booking.
      findSlots($('#reschedule-slots'), state.reschedule.serviceId, state.reschedule.stylistId, date, (slot) => {
        state.reschedule.start = slot.start_utc;
        let row = document.getElementById('reschedule-confirm-row');
        if (!row) {
          row = document.createElement('p');
          row.id = 'reschedule-confirm-row';
          $('#reschedule-slots').appendChild(row);
        }
        row.innerHTML =
          `New time selected: <strong>${esc(slot.label)}</strong> on ${esc(date)}. ` +
          `<button type="button" class="btn btn-primary" id="btn-confirm-reschedule">Confirm new time</button>`;
        $('#btn-confirm-reschedule').addEventListener('click', confirmReschedule);
        $('#btn-confirm-reschedule').focus();
      });
    });
    $('#btn-cancel-reschedule').addEventListener('click', () => {
      $('#reschedule-card').hidden = true;
    });

    $('#admin-filters').addEventListener('submit', (e) => {
      e.preventDefault();
      state.admin.page = 1;
      state.admin.date = $('#filter-date').value;
      state.admin.stylistId = $('#filter-stylist').value;
      state.admin.status = $('#filter-status').value;
      loadAdmin();
    });
    $('#btn-filter-clear').addEventListener('click', () => {
      state.admin = { page: 1, date: '', stylistId: '', status: '' };
      $('#filter-date').value = '';
      $('#filter-stylist').value = '';
      $('#filter-status').value = '';
      loadAdmin();
    });

    window.addEventListener('hashchange', navigate);
  }

  async function boot() {
    wireEvents();
    try {
      const me = await api('GET', '/api/auth/me');
      state.user = me.user;
      await bootData();
    } catch {
      state.user = null;
      try {
        const meta = await api('GET', '/api/meta');
        state.meta = meta;
        $('#clock-note').hidden = !meta.clock_override;
        if (meta.clock_override) $('#clock-value').textContent = meta.now_utc;
        $('#footer-tz').textContent = meta.salon_timezone;
      } catch { /* server unreachable; forms will surface errors */ }
    }
    renderNav();
    navigate();
  }

  boot();
})();
