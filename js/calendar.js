// calendar.js — grid rendering for day/week/month, pointer-based drag-create,
// drag-move (via a floating ghost that sticks to the cursor), and resize.
// All times snap to 15-minute increments.

const CalendarView = (() => {
  const { toDateStr, fromDateStr, addDays, timeToMinutes, minutesToTime } = window.Model;

  const HOUR_PX = 56;
  const SNAP_MIN = 15;
  const DAY_END_MIN = 24 * 60;

  let view = 'week';           // 'day' | 'week' | 'month'
  let anchorDate = toDateStr(new Date());
  let onTaskClick = () => {};
  let onSlotCreate = () => {};
  let onTaskMoved = () => {};

  // A single shared drag controller avoids leaking window listeners on
  // every re-render (each render replaces all task-block elements).
  let dragState = null;
  window.addEventListener('mousemove', (e) => { if (dragState) dragState.onMove(e); });
  window.addEventListener('mouseup', (e) => {
    if (!dragState) return;
    const ds = dragState;
    dragState = null;
    ds.onUp(e);
  });

  function init(handlers) {
    onTaskClick = handlers.onTaskClick || onTaskClick;
    onSlotCreate = handlers.onSlotCreate || onSlotCreate;
    onTaskMoved = handlers.onTaskMoved || onTaskMoved;
  }

  function setView(v) { view = v; render(); }
  function getView() { return view; }
  function setAnchor(dateStr) { anchorDate = dateStr; render(); }
  function getAnchor() { return anchorDate; }

  function shift(delta) {
    if (view === 'day') anchorDate = addDays(anchorDate, delta);
    else if (view === 'week') anchorDate = addDays(anchorDate, delta * 7);
    else {
      const d = fromDateStr(anchorDate);
      d.setMonth(d.getMonth() + delta);
      anchorDate = toDateStr(d);
    }
    render();
  }

  function weekStart(dateStr) {
    const d = fromDateStr(dateStr);
    d.setDate(d.getDate() - d.getDay());
    return toDateStr(d);
  }

  function rangeForView() {
    if (view === 'day') return [anchorDate, anchorDate];
    if (view === 'week') {
      const start = weekStart(anchorDate);
      return [start, addDays(start, 6)];
    }
    const d = fromDateStr(anchorDate);
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const gridStart = new Date(first); gridStart.setDate(gridStart.getDate() - gridStart.getDay());
    const gridEnd = new Date(last); gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));
    return [toDateStr(gridStart), toDateStr(gridEnd)];
  }

  function priorityClass(task) {
    return 'pri-' + (task.priority || 'not_urgent');
  }

  function fmtHeaderLabel() {
    const [s, e] = rangeForView();
    const opts = { month: 'short', day: 'numeric' };
    if (view === 'month') {
      return fromDateStr(anchorDate).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    }
    return `${fromDateStr(s).toLocaleDateString(undefined, opts)} – ${fromDateStr(e).toLocaleDateString(undefined, { ...opts, year: 'numeric' })}`;
  }

  function render() {
    const root = document.getElementById('calendar-root');
    root.innerHTML = '';
    document.getElementById('range-label').textContent = fmtHeaderLabel();
    const [rs, re] = rangeForView();
    window.Store.ensureRecurringInstances(addDays(rs, -3), addDays(re, 3));

    if (view === 'month') renderMonth(root);
    else renderTimeGrid(root);
  }

  // ---------- Day / Week grid ----------
  function renderTimeGrid(root) {
    const [rs, re] = rangeForView();
    const days = [];
    let cur = rs;
    while (cur <= re) { days.push(cur); cur = addDays(cur, 1); }

    const grid = document.createElement('div');
    grid.className = 'time-grid';
    grid.style.setProperty('--cols', days.length);

    const headerRow = document.createElement('div');
    headerRow.className = 'grid-header-row';
    const corner = document.createElement('div');
    corner.className = 'grid-corner';
    headerRow.appendChild(corner);
    const todayStr = toDateStr(new Date());
    days.forEach(d => {
      const h = document.createElement('div');
      h.className = 'day-header' + (d === todayStr ? ' is-today' : '');
      const dow = fromDateStr(d).toLocaleDateString(undefined, { weekday: 'short' });
      const num = fromDateStr(d).getDate();
      h.innerHTML = `<span class="dow">${dow}</span><span class="dnum">${num}</span>`;
      headerRow.appendChild(h);
    });
    grid.appendChild(headerRow);

    const body = document.createElement('div');
    body.className = 'grid-body';
    body.style.setProperty('--cols', days.length);
    body.style.height = `${(DAY_END_MIN / 60) * HOUR_PX}px`;

    const hourCol = document.createElement('div');
    hourCol.className = 'hour-col';
    for (let h = 0; h < 24; h++) {
      const lbl = document.createElement('div');
      lbl.className = 'hour-label';
      lbl.style.top = `${h * HOUR_PX}px`;
      lbl.textContent = fmtHour(h);
      hourCol.appendChild(lbl);
    }
    body.appendChild(hourCol);

    days.forEach((d, idx) => {
      const col = document.createElement('div');
      col.className = 'day-col' + (d === todayStr ? ' is-today' : '');
      col.dataset.date = d;
      col.style.left = `calc(var(--hour-col-w) + ${idx} * ((100% - var(--hour-col-w)) / ${days.length}))`;
      col.style.width = `calc((100% - var(--hour-col-w)) / ${days.length})`;

      for (let h = 0; h < 24; h++) {
        const line = document.createElement('div');
        line.className = 'hour-line';
        line.style.top = `${h * HOUR_PX}px`;
        col.appendChild(line);
      }

      const win = Scheduler.workingWindow(window.Store, d);
      const shade = document.createElement('div');
      shade.className = 'working-shade';
      shade.style.top = `${(timeToMinutes(win.start) / 60) * HOUR_PX}px`;
      shade.style.height = `${((timeToMinutes(win.end) - timeToMinutes(win.start)) / 60) * HOUR_PX}px`;
      col.appendChild(shade);

      col.style.height = `${(DAY_END_MIN / 60) * HOUR_PX}px`;
      attachSlotCreation(col, d);

      window.Store.getTasksOnDate(d).forEach(task => {
        col.appendChild(renderTimedTaskBlock(task));
      });

      body.appendChild(col);
    });

    grid.appendChild(body);
    root.appendChild(grid);
  }

  function fmtHour(h) {
    if (h === 0) return '12 AM';
    if (h === 12) return '12 PM';
    return h < 12 ? `${h} AM` : `${h - 12} PM`;
  }

  function renderTimedTaskBlock(task) {
    const startMin = timeToMinutes(task.startTime);
    const endMin = timeToMinutes(task.endTime);
    const el = document.createElement('div');
    el.className = [
      'task-block',
      priorityClass(task),
      task.deadline ? 'has-deadline' : '',
      task.missed ? 'is-missed' : '',
      task.completed ? 'is-completed' : ''
    ].filter(Boolean).join(' ');
    el.style.top = `${(startMin / 60) * HOUR_PX}px`;
    el.style.height = `${Math.max(22, ((endMin - startMin) / 60) * HOUR_PX)}px`;
    el.dataset.taskId = task.id;

    const title = document.createElement('div');
    title.className = 'task-title';
    title.textContent = task.title || 'Untitled task';
    const time = document.createElement('div');
    time.className = 'task-time';
    time.textContent = `${task.startTime} – ${task.endTime}`;

    const actions = document.createElement('div');
    actions.className = 'task-actions';
    const tickBtn = document.createElement('button');
    tickBtn.type = 'button';
    tickBtn.className = 'task-btn tick-btn';
    tickBtn.title = 'Done';
    tickBtn.textContent = '✓';
    const xBtn = document.createElement('button');
    xBtn.type = 'button';
    xBtn.className = 'task-btn x-btn';
    xBtn.title = "Didn't do this — reschedule";
    xBtn.textContent = '✕';
    actions.appendChild(tickBtn);
    actions.appendChild(xBtn);

    [tickBtn, xBtn].forEach(b => b.addEventListener('mousedown', e => e.stopPropagation()));
    tickBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      History.record();
      window.Store.updateTask(task.id, { completed: true, missed: false });
      render();
    });
    xBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      History.record();
      window.Store.updateTask(task.id, { missed: true, completed: false });
      Scheduler.rescheduleMissed(window.Store, task.id, task.date);
      render();
    });

    el.appendChild(title);
    el.appendChild(time);
    el.appendChild(actions);

    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    el.appendChild(handle);

    attachTaskPointer(el, task, handle);

    return el;
  }

  // ---------- Month view ----------
  function renderMonth(root) {
    const [gs, ge] = rangeForView();
    const wrap = document.createElement('div');
    wrap.className = 'month-grid';

    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(d => {
      const h = document.createElement('div');
      h.className = 'month-dow';
      h.textContent = d;
      wrap.appendChild(h);
    });

    const todayStr = toDateStr(new Date());
    const curMonth = fromDateStr(anchorDate).getMonth();
    let cur = gs;
    while (cur <= ge) {
      const cell = document.createElement('div');
      const inMonth = fromDateStr(cur).getMonth() === curMonth;
      cell.className = 'month-cell' + (cur === todayStr ? ' is-today' : '') + (inMonth ? '' : ' is-outside');
      cell.dataset.date = cur;
      const num = document.createElement('div');
      num.className = 'month-daynum';
      num.textContent = fromDateStr(cur).getDate();
      cell.appendChild(num);

      const list = document.createElement('div');
      list.className = 'month-tasklist';
      window.Store.getTasksOnDate(cur).slice(0, 4).forEach(task => {
        const chip = document.createElement('div');
        chip.className = 'month-chip ' + priorityClass(task) + (task.missed ? ' is-missed' : '') + (task.completed ? ' is-completed' : '');
        chip.textContent = `${task.startTime} ${task.title || 'Untitled'}`;
        chip.dataset.taskId = task.id;
        chip.draggable = true;
        chip.addEventListener('click', (e) => { e.stopPropagation(); onTaskClick(task.id); });
        chip.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/task-id', task.id);
        });
        list.appendChild(chip);
      });
      cell.appendChild(list);

      cell.addEventListener('dragover', (e) => e.preventDefault());
      cell.addEventListener('drop', (e) => {
        e.preventDefault();
        const taskId = e.dataTransfer.getData('text/task-id');
        if (!taskId) return;
        const task = window.Store.getTask(taskId);
        if (!task) return;
        History.record();
        Scheduler.placeTask(window.Store, taskId, cell.dataset.date, task.startTime, task.endTime);
        onTaskMoved();
        render();
      });
      cell.addEventListener('dblclick', () => {
        onSlotCreate(cell.dataset.date, '09:00', '10:00');
      });

      wrap.appendChild(cell);
      cur = addDays(cur, 1);
    }
    root.appendChild(wrap);
  }

  // ---------- Pointer interactions: create by drag ----------
  function attachSlotCreation(col, dateStr) {
    let ghost = null;
    let startY = 0;

    function updateGhost(y1, y2) {
      const top = Math.min(y1, y2);
      const height = Math.max(SNAP_MIN / 60 * HOUR_PX, Math.abs(y2 - y1));
      ghost.style.top = `${top}px`;
      ghost.style.height = `${height}px`;
    }
    function yToMinutes(y) {
      return Math.round((y / HOUR_PX) * 60 / SNAP_MIN) * SNAP_MIN;
    }

    col.addEventListener('mousedown', (e) => {
      if (e.target !== col) return; // ignore clicks on children (tasks etc.)
      startY = e.offsetY;
      ghost = document.createElement('div');
      ghost.className = 'create-ghost';
      col.appendChild(ghost);
      updateGhost(startY, startY);
      e.preventDefault();

      dragState = {
        onMove(ev) {
          const rect = col.getBoundingClientRect();
          const y = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));
          updateGhost(startY, y);
        },
        onUp(ev) {
          const rect = col.getBoundingClientRect();
          const y = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));
          let m1 = yToMinutes(startY);
          let m2 = yToMinutes(y);
          if (m2 < m1) [m1, m2] = [m2, m1];
          if (m2 - m1 < SNAP_MIN) m2 = m1 + 60; // a plain click defaults to a 1-hour task
          ghost.remove();
          onSlotCreate(dateStr, minutesToTime(m1), minutesToTime(m2));
        }
      };
    });
  }

  // ---------- Pointer interactions: move (floating ghost) / resize ----------
  // Drag activation is deferred: mousedown alone never moves anything or
  // opens a ghost. Only once the cursor has actually traveled past a small
  // threshold does a real drag begin — otherwise the browser's native click
  // event fires normally and opens the task for editing. This is what makes
  // "click to open" and "drag to move" reliably distinguishable.
  const DRAG_ACTIVATE_PX = 5;

  function snapMinutesFromPx(px) {
    return Math.max(0, Math.round((px / HOUR_PX) * 60 / SNAP_MIN) * SNAP_MIN);
  }

  function attachTaskPointer(el, task, handle) {
    let suppressNextClick = false;

    el.addEventListener('click', (e) => {
      if (e.target.closest('.tick-btn') || e.target.closest('.x-btn')) return;
      if (suppressNextClick) { suppressNextClick = false; return; }
      onTaskClick(task.id);
    });

    el.addEventListener('mousedown', (e) => {
      if (e.target.closest('.tick-btn') || e.target.closest('.x-btn')) return;
      const isResize = e.target === handle;
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      e.preventDefault();

      let activated = false;
      let live = null;

      dragState = {
        onMove(ev) {
          if (!activated) {
            const dist = Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY);
            if (dist < DRAG_ACTIVATE_PX) return;
            activated = true;
            suppressNextClick = true;
            live = isResize
              ? startResize(el, task, startClientY)
              : startMove(el, task, startClientX, startClientY);
          }
          live.onMove(ev);
        },
        onUp(ev) {
          if (activated && live) live.onUp(ev);
          // otherwise: this was a plain click. The native 'click' listener
          // above fires right after this and opens the task.
        }
      };
    });
  }

  function startMove(el, task, startClientX, startClientY) {
    const rect = el.getBoundingClientRect();
    const grabOffsetX = startClientX - rect.left;
    const grabOffsetY = startClientY - rect.top;

    const ghost = el.cloneNode(true);
    ghost.classList.add('drag-ghost-el');
    ghost.style.position = 'fixed';
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.margin = '0';
    ghost.style.pointerEvents = 'none';
    document.body.appendChild(ghost);
    el.classList.add('is-dragging-source');

    // A prominent floating badge that follows the cursor and always shows
    // the exact time the task will snap to if dropped right now.
    const badge = document.createElement('div');
    badge.className = 'drag-time-badge';
    document.body.appendChild(badge);

    let lastTargetCol = el.parentElement;
    const dur = timeToMinutes(task.endTime) - timeToMinutes(task.startTime);

    function updatePreview(ev, targetCol) {
      const colRect = targetCol.getBoundingClientRect();
      const relY = (ev.clientY - grabOffsetY) - colRect.top;
      const snappedMin = snapMinutesFromPx(relY);
      const label = `${minutesToTime(snappedMin)} – ${minutesToTime(snappedMin + dur)}`;
      badge.textContent = label;
      badge.style.left = `${ev.clientX + 16}px`;
      badge.style.top = `${ev.clientY + 16}px`;
      return snappedMin;
    }

    return {
      onMove(ev) {
        ghost.style.left = `${ev.clientX - grabOffsetX}px`;
        ghost.style.top = `${ev.clientY - grabOffsetY}px`;

        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        const targetCol = under && under.closest('.day-col');
        if (targetCol) {
          lastTargetCol = targetCol;
          updatePreview(ev, targetCol);
          badge.classList.remove('is-outside');
        } else {
          badge.classList.add('is-outside');
        }
      },
      onUp(ev) {
        ghost.remove();
        badge.remove();
        el.classList.remove('is-dragging-source');

        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        const targetCol = (under && under.closest('.day-col')) || lastTargetCol;
        if (!targetCol) { render(); return; }

        const colRect = targetCol.getBoundingClientRect();
        const relY = (ev.clientY - grabOffsetY) - colRect.top;
        // No clamping to the working-hours window here — manual drag can
        // land anywhere the user drops it; only auto-reschedule respects
        // the window.
        const snappedMin = snapMinutesFromPx(relY);
        const newStart = minutesToTime(snappedMin);
        const newEnd = minutesToTime(snappedMin + dur);

        History.record();
        Scheduler.placeTask(window.Store, task.id, targetCol.dataset.date, newStart, newEnd);
        onTaskMoved();
        render();
      }
    };
  }

  function startResize(el, task, startClientY) {
    const startHeight = parseFloat(el.style.height);
    el.classList.add('is-dragging');

    const badge = document.createElement('div');
    badge.className = 'drag-time-badge';
    document.body.appendChild(badge);

    return {
      onMove(ev) {
        const dy = ev.clientY - startClientY;
        const rawHeight = Math.max(20, startHeight + dy);
        const snappedMin = Math.max(SNAP_MIN, snapMinutesFromPx(rawHeight));
        el.style.height = `${(snappedMin / 60) * HOUR_PX}px`;

        const newEnd = minutesToTime(timeToMinutes(task.startTime) + snappedMin);
        badge.textContent = `${task.startTime} – ${newEnd}`;
        badge.style.left = `${ev.clientX + 16}px`;
        badge.style.top = `${ev.clientY + 16}px`;
      },
      onUp() {
        el.classList.remove('is-dragging');
        badge.remove();
        const heightPx = parseFloat(el.style.height);
        const durMin = Math.max(SNAP_MIN, snapMinutesFromPx(heightPx));
        const newEnd = minutesToTime(timeToMinutes(task.startTime) + durMin);
        History.record();
        Scheduler.placeTask(window.Store, task.id, task.date, task.startTime, newEnd);
        onTaskMoved();
        render();
      }
    };
  }

  return { init, render, setView, getView, setAnchor, getAnchor, shift, rangeForView };
})();

window.CalendarView = CalendarView;
