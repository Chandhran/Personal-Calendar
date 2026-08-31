// app.js — glues Store, Scheduler, CalendarView, Notifier together; owns the
// task modal and settings modal.

(function () {
  const { toDateStr, fromDateStr, newTask, uid, PRIORITY_ORDER, PRIORITY_LABEL, NOTIF_OPTIONS } = window.Model;

  let editingId = null;

  function $(sel) { return document.querySelector(sel); }

  function openTaskModal(prefill = {}) {
    editingId = prefill.id || null;
    const t = editingId ? window.Store.getTask(editingId) : newTask(prefill);
    $('#modal-title-input').value = t.title || '';
    $('#modal-date').value = t.date;
    $('#modal-start').value = t.startTime;
    $('#modal-end').value = t.endTime;
    $('#modal-deadline').value = t.deadline || '';
    $('#modal-priority').value = t.priority;
    $('#modal-recurrence').value = (t.recurrence && t.recurrence.type) || 'none';
    renderWeekdayPicker(t.recurrence);
    renderNotifChecks(t.notifications || [30]);
    $('#modal-delete').style.display = editingId ? 'inline-flex' : 'none';
    $('#task-modal').classList.add('open');
    $('#modal-title-input').focus();
  }

  function closeTaskModal() {
    $('#task-modal').classList.remove('open');
    editingId = null;
  }

  function renderWeekdayPicker(rec) {
    const wrap = $('#weekday-picker');
    wrap.innerHTML = '';
    const recVal = $('#modal-recurrence').value;
    const show = recVal === 'weekly' || recVal === 'custom';
    wrap.style.display = show ? 'flex' : 'none';
    $('#custom-recur-row').classList.toggle('show', recVal === 'custom');
    const labels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const selected = new Set((rec && rec.weekdays) || []);
    labels.forEach((lbl, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wd-btn' + (selected.has(i) ? ' active' : '');
      btn.textContent = lbl;
      btn.dataset.day = i;
      btn.addEventListener('click', () => btn.classList.toggle('active'));
      wrap.appendChild(btn);
    });
  }

  function renderNotifChecks(selected) {
    const wrap = $('#notif-options');
    wrap.innerHTML = '';
    NOTIF_OPTIONS.forEach(opt => {
      const label = document.createElement('label');
      label.className = 'notif-chip';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = opt.value;
      cb.checked = selected.includes(opt.value);
      label.appendChild(cb);
      label.append(' ' + opt.label);
      wrap.appendChild(label);
    });
  }

  function collectWeekdays() {
    return [...document.querySelectorAll('#weekday-picker .wd-btn.active')].map(b => Number(b.dataset.day));
  }

  function collectNotifs() {
    return [...document.querySelectorAll('#notif-options input:checked')].map(i => Number(i.value));
  }

  // ---------- Recurring-task edit scope (this occurrence vs. following) ----------
  function promptRecurrenceScope(task, onChoice) {
    if (!task.recurrenceId) { onChoice('this'); return; }
    const modal = $('#scope-modal');
    modal.classList.add('open');
    function cleanup() {
      modal.classList.remove('open');
      $('#scope-this').removeEventListener('click', chooseThis);
      $('#scope-following').removeEventListener('click', chooseFollowing);
      $('#scope-cancel').removeEventListener('click', chooseCancel);
    }
    function chooseThis() { cleanup(); onChoice('this'); }
    function chooseFollowing() { cleanup(); onChoice('following'); }
    function chooseCancel() { cleanup(); onChoice(null); }
    $('#scope-this').addEventListener('click', chooseThis);
    $('#scope-following').addEventListener('click', chooseFollowing);
    $('#scope-cancel').addEventListener('click', chooseCancel);
  }
  window.promptRecurrenceScope = promptRecurrenceScope;

  function saveFromModal() {
    const title = $('#modal-title-input').value.trim() || 'Untitled task';
    const date = $('#modal-date').value;
    const startTime = $('#modal-start').value;
    const endTime = $('#modal-end').value;
    const deadline = $('#modal-deadline').value || null;
    const priority = $('#modal-priority').value;
    const recType = $('#modal-recurrence').value;
    const notifications = collectNotifs();

    if (endTime <= startTime) {
      alert('End time must be after start time.');
      return;
    }

    const recurrence = recType === 'none' ? { type: 'none' } : {
      type: recType,
      weekdays: (recType === 'weekly' || recType === 'custom') ? collectWeekdays() : undefined,
      interval: recType === 'custom' ? Number($('#modal-custom-interval').value || 1) : undefined,
      unit: recType === 'custom' ? $('#modal-custom-unit').value : undefined,
      until: $('#modal-recur-until').value || undefined
    };

    const applyEdit = (scope) => {
      if (scope === null) return; // cancelled — nothing to do
      History.record();
      if (editingId) {
        if (scope === 'following') {
          const edits = { title, startTime, endTime, deadline, priority, notifications };
          const newMaster = window.Store.splitSeriesFrom(editingId, edits);
          if (newMaster) {
            const [rs, re] = CalendarView.rangeForView();
            window.Store.ensureRecurringInstances(rs, re);
          }
        } else {
          window.Store.updateTask(editingId, { title, date, startTime, endTime, deadline, priority, notifications });
          Scheduler.placeTask(window.Store, editingId, date, startTime, endTime);
        }
      } else if (recType !== 'none') {
        const recurrenceId = uid();
        const master = newTask({ title, date, startTime, endTime, deadline, priority, notifications, recurrence, recurrenceId });
        window.Store.addMaster(master);
        const [rs, re] = CalendarView.rangeForView();
        window.Store.ensureRecurringInstances(rs, re);
      } else {
        const task = newTask({ title, date, startTime, endTime, deadline, priority, notifications });
        window.Store.addTask(task);
        Scheduler.placeTask(window.Store, task.id, date, startTime, endTime);
      }
      closeTaskModal();
      CalendarView.render();
    };

    const editingTask = editingId ? window.Store.getTask(editingId) : null;
    if (editingTask && editingTask.recurrenceId) {
      promptRecurrenceScope(editingTask, applyEdit);
    } else {
      applyEdit('this');
    }
  }

  function deleteFromModal() {
    if (!editingId) return;
    History.record();
    const t = window.Store.getTask(editingId);
    if (t && t.recurrenceId && confirm('Delete the entire recurring series? Cancel to delete just this one.')) {
      window.Store.removeSeries(t.recurrenceId);
    } else {
      window.Store.removeTask(editingId);
    }
    closeTaskModal();
    CalendarView.render();
  }

  // ---------- Settings modal (GitHub sync config + working hours) ----------
  function openSettings() {
    const cfg = window.Store.getConfig();
    $('#cfg-owner').value = cfg.owner;
    $('#cfg-repo').value = cfg.repo;
    $('#cfg-path').value = cfg.path;
    $('#cfg-branch').value = cfg.branch;
    $('#cfg-token').value = '';
    $('#cfg-token').placeholder = cfg.token ? 'Token saved (leave blank to keep)' : 'ghp_...';

    const anchor = CalendarView.getAnchor();
    const win = window.Store.getWorkingHours(anchor);
    $('#wh-date').value = anchor;
    $('#wh-start').value = win ? win.start : '09:00';
    $('#wh-end').value = win ? win.end : '21:00';

    $('#settings-modal').classList.add('open');
  }
  function closeSettings() { $('#settings-modal').classList.remove('open'); }

  function saveGithubConfig() {
    const token = $('#cfg-token').value.trim();
    const next = {
      owner: $('#cfg-owner').value.trim(),
      repo: $('#cfg-repo').value.trim(),
      path: $('#cfg-path').value.trim() || 'calendar-data.json',
      branch: $('#cfg-branch').value.trim() || 'main'
    };
    if (token) next.token = token;
    window.Store.setConfig(next);
    setSyncStatus('checking');
    window.Store.pullFromGitHub().then(res => {
      setSyncStatus(res.ok ? 'ok' : 'error', res.reason);
      CalendarView.render();
    });
  }

  function saveWorkingHours() {
    const date = $('#wh-date').value;
    const start = $('#wh-start').value;
    const end = $('#wh-end').value;
    History.record();
    window.Store.setWorkingHours(date, { start, end });
    CalendarView.render();
  }

  function clearWorkingHours() {
    const date = $('#wh-date').value;
    History.record();
    window.Store.setWorkingHours(date, null);
    CalendarView.render();
  }

  function setSyncStatus(status, detail) {
    const el = $('#sync-status');
    el.className = 'sync-status sync-' + status;
    el.title = detail || '';
    el.textContent = { ok: 'Synced', error: 'Sync error', checking: 'Syncing…', off: 'Local only' }[status] || status;
  }

  // ---------- Init ----------
  function wireHeader() {
    $('#btn-today').addEventListener('click', () => CalendarView.setAnchor(toDateStr(new Date())));
    $('#btn-prev').addEventListener('click', () => CalendarView.shift(-1));
    $('#btn-next').addEventListener('click', () => CalendarView.shift(1));
    $('#view-select').addEventListener('change', (e) => CalendarView.setView(e.target.value));
    $('#btn-add-task').addEventListener('click', () => openTaskModal({ date: CalendarView.getAnchor() }));
    $('#btn-settings').addEventListener('click', openSettings);
    $('#btn-undo').addEventListener('click', doUndo);
    window.addEventListener('keydown', (e) => {
      const isUndoKey = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z';
      if (isUndoKey && !document.querySelector('.modal-overlay.open')) {
        e.preventDefault();
        doUndo();
      }
    });
  }

  function doUndo() {
    if (!History.canUndo()) return;
    History.undo();
    CalendarView.render();
  }

  function wireTaskModal() {
    $('#modal-close').addEventListener('click', closeTaskModal);
    $('#modal-cancel').addEventListener('click', closeTaskModal);
    $('#modal-save').addEventListener('click', saveFromModal);
    $('#modal-delete').addEventListener('click', deleteFromModal);
    $('#modal-recurrence').addEventListener('change', () => renderWeekdayPicker(null));
    $('#task-modal').addEventListener('click', (e) => { if (e.target.id === 'task-modal') closeTaskModal(); });
  }

  function wireEscapeToClose() {
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if ($('#task-modal').classList.contains('open')) closeTaskModal();
      else if ($('#settings-modal').classList.contains('open')) closeSettings();
    });
  }

  function wireSettingsModal() {
    $('#settings-close').addEventListener('click', closeSettings);
    $('#cfg-save').addEventListener('click', saveGithubConfig);
    $('#wh-save').addEventListener('click', saveWorkingHours);
    $('#wh-clear').addEventListener('click', clearWorkingHours);
    $('#settings-modal').addEventListener('click', (e) => { if (e.target.id === 'settings-modal') closeSettings(); });
  }

  function init() {
    wireHeader();
    wireTaskModal();
    wireSettingsModal();
    wireEscapeToClose();

    CalendarView.init({
      onTaskClick: (id) => openTaskModal({ id }),
      onSlotCreate: (date, start, end) => openTaskModal({ date, startTime: start, endTime: end }),
      onTaskMoved: () => { /* placeTask already marks dirty via Store.updateTask calls */ }
    });

    document.addEventListener('sync-ok', () => setSyncStatus('ok'));
    document.addEventListener('sync-error', (e) => setSyncStatus('error', e.detail));

    if (window.Store.isConfigured()) {
      setSyncStatus('checking');
      window.Store.pullFromGitHub().then(res => {
        setSyncStatus(res.ok ? 'ok' : 'error', res.reason);
        CalendarView.render();
      });
    } else {
      setSyncStatus('off');
    }

    Notifier.registerServiceWorker();
    Notifier.requestPermission().then(() => Notifier.start());

    CalendarView.setView('week');
    CalendarView.render();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
