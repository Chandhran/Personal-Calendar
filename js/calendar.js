// calendar.js — grid rendering for day/week/month, pointer-based drag-create,
// drag-move, and resize. All times snap to 15-minute increments.

const CalendarView = (() => {
  const { toDateStr, fromDateStr, addDays, timeToMinutes, minutesToTime, pad2 } = window.Model;

  const HOUR_PX = 56;
  const SNAP_MIN = 15;
  const DAY_START_MIN = 0;
  const DAY_END_MIN = 24 * 60;

  let view = 'week';           // 'day' | 'week' | 'month'
  let anchorDate = toDateStr(new Date());
  let onTaskClick = () => {};
  let onSlotCreate = () => {};
  let onTaskMoved = () => {};

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
    // month: full weeks covering the month grid
    const d = fromDateStr(anchorDate);
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const gridStart = new Date(first); gridStart.setDate(gridStart.getDate() - gridStart.getDay());
    const gridEnd = new Date(last); gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));
    return [toDateStr(gridStart), toDateStr(gridEnd)];
  }

  function priorityColorVar(task) {
    if (task.deadline) return 'var(--deadline)';
    return `var(--pri-${task.priority})`;
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
    // ensure recurring instances exist for the visible window (+buffer)
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

    // corner + day headers
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

    // hour labels column
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
    el.className = 'task-block' + (task.missed ? ' is-missed' : '') + (task.completed ? ' is-completed' : '');
    el.style.top = `${(startMin / 60) * HOUR_PX}px`;
    el.style.height = `${Math.max(20, ((endMin - startMin) / 60) * HOUR_PX)}px`;
    el.style.borderLeftColor = priorityColorVar(task);
    el.dataset.taskId = task.id;

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'missed-check';
    check.checked = task.missed;
    check.title = "Didn't do this — reschedule it";
    check.addEventListener('click', e => e.stopPropagation());
    check.addEventListener('change', () => {
      window.Store.updateTask(task.id, { missed: check.checked });
      if (check.checked) {
        Scheduler.rescheduleMissed(window.Store, task.id, task.date);
      }
      render();
    });

    const title = document.createElement('div');
    title.className = 'task-title';
    title.textContent = task.title || 'Untitled task';
    const time = document.createElement('div');
    time.className = 'task-time';
    time.textContent = `${task.startTime} – ${task.endTime}`;

    el.appendChild(check);
    el.appendChild(title);
    el.appendChild(time);

    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    el.appendChild(handle);

    attachTaskDrag(el, task, handle);
    el.addEventListener('click', (e) => {
      if (e.target === check || e.target === handle) return;
      onTaskClick(task.id);
    });

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
        chip.className = 'month-chip' + (task.missed ? ' is-missed' : '');
        chip.style.borderLeftColor = priorityColorVar(task);
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
    let dragging = false;
    let startY = 0;
    let ghost = null;

    col.addEventListener('mousedown', (e) => {
      if (e.target !== col) return; // ignore clicks on children (tasks etc.)
      dragging = true;
      startY = e.offsetY;
      ghost = document.createElement('div');
      ghost.className = 'create-ghost';
      col.appendChild(ghost);
      updateGhost(startY, startY);
      e.preventDefault();
    });

    function updateGhost(y1, y2) {
      const top = Math.min(y1, y2);
      const height = Math.max(SNAP_MIN / 60 * HOUR_PX, Math.abs(y2 - y1));
      ghost.style.top = `${top}px`;
      ghost.style.height = `${height}px`;
    }

    function yToMinutes(y) {
      const raw = (y / HOUR_PX) * 60;
      return Math.round(raw / SNAP_MIN) * SNAP_MIN;
    }

    function onMove(e) {
      if (!dragging) return;
      const rect = col.getBoundingClientRect();
      const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      updateGhost(startY, y);
    }
    function onUp(e) {
      if (!dragging) return;
      dragging = false;
      const rect = col.getBoundingClientRect();
      const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      let m1 = yToMinutes(startY);
      let m2 = yToMinutes(y);
      if (m2 < m1) [m1, m2] = [m2, m1];
      if (m2 - m1 < SNAP_MIN) m2 = m1 + 60; // treat a plain click as a 1-hour default
      ghost.remove();
      onSlotCreate(dateStr, minutesToTime(m1), minutesToTime(m2));
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ---------- Pointer interactions: move / resize existing task ----------
  function attachTaskDrag(el, task, handle) {
    let mode = null; // 'move' | 'resize'
    let startY = 0, startTop = 0, startHeight = 0;
    let col = null;

    function beginMove(e) {
      mode = 'move';
      col = el.parentElement;
      startY = e.clientY;
      startTop = parseFloat(el.style.top);
      el.classList.add('is-dragging');
      e.preventDefault();
      e.stopPropagation();
    }
    function beginResize(e) {
      mode = 'resize';
      col = el.parentElement;
      startY = e.clientY;
      startHeight = parseFloat(el.style.height);
      el.classList.add('is-dragging');
      e.preventDefault();
      e.stopPropagation();
    }
    el.addEventListener('mousedown', (e) => {
      if (e.target === handle) beginResize(e);
      else if (e.target.tagName !== 'INPUT') beginMove(e);
    });

    function snap(px) { return Math.round((px / HOUR_PX) * 60 / SNAP_MIN) * SNAP_MIN; }

    function onMove(e) {
      if (!mode) return;
      const dy = e.clientY - startY;
      if (mode === 'move') {
        el.style.top = `${Math.max(0, startTop + dy)}px`;
        // allow dragging across columns: reparent ghost visually via cursor tracking
        const target = document.elementFromPoint(e.clientX, e.clientY);
        const targetCol = target && target.closest('.day-col');
        if (targetCol && targetCol !== col) {
          col._dragTargetOverride = targetCol;
        } else if (targetCol === col) {
          col._dragTargetOverride = null;
        }
      } else {
        el.style.height = `${Math.max(20, startHeight + dy)}px`;
      }
    }

    function onUp(e) {
      if (!mode) return;
      const wasMode = mode;
      mode = null;
      el.classList.remove('is-dragging');
      const targetCol = col._dragTargetOverride || col;
      col._dragTargetOverride = null;

      if (wasMode === 'move') {
        const topPx = parseFloat(el.style.top);
        const startMin = snap((topPx / HOUR_PX) * 60);
        const dur = timeToMinutes(task.endTime) - timeToMinutes(task.startTime);
        const newStart = minutesToTime(startMin);
        const newEnd = minutesToTime(startMin + dur);
        Scheduler.placeTask(window.Store, task.id, targetCol.dataset.date, newStart, newEnd);
      } else {
        const heightPx = parseFloat(el.style.height);
        const durMin = Math.max(SNAP_MIN, snap((heightPx / HOUR_PX) * 60));
        const newEnd = minutesToTime(timeToMinutes(task.startTime) + durMin);
        Scheduler.placeTask(window.Store, task.id, task.date, task.startTime, newEnd);
      }
      onTaskMoved();
      render();
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return { init, render, setView, getView, setAnchor, getAnchor, shift, rangeForView };
})();

window.CalendarView = CalendarView;
