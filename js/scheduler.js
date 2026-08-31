// scheduler.js — the "personal assistant" reflow engine.
//
// Model: each calendar day has a working-hours window (per-date override, else
// default 09:00-21:00). When a task is dropped/moved/missed, we re-lay-out the
// tasks touching that day in rank order (deadline-first, then priority),
// giving each the earliest slot on/after its preferred start that doesn't
// collide with an already-placed higher-rank task. Lower-rank tasks that don't
// fit get pushed later, and if they overflow the day's window entirely they
// roll to the next day and are placed there by the same hierarchy.

const Scheduler = (() => {
  const { timeToMinutes, minutesToTime, durationMinutes, compareRank, addDays } = window.Model;

  function workingWindow(store, dateStr) {
    const override = store.getWorkingHours(dateStr);
    if (override) return override;
    return { start: '09:00', end: '21:00' };
  }

  // Attempt to place `task` (with its own preferred/duration) into `placed`
  // (already-committed tasks for this day, sorted by start) without
  // overlapping, searching forward from `earliestStart` within `windowEnd`.
  // Returns a start-minute or null if it doesn't fit anywhere in the window.
  function findSlot(placed, earliestStart, windowEndMin, dur) {
    let candidate = Math.max(earliestStart, 0);
    const sorted = [...placed].sort((a, b) => a._startMin - b._startMin);
    for (const p of sorted) {
      if (candidate + dur <= p._startMin) break; // fits before this one
      candidate = Math.max(candidate, p._endMin);
    }
    if (candidate + dur > windowEndMin) return null;
    return candidate;
  }

  // Core: lay out all tasks assigned to `dateStr` (array of task objects,
  // mutated in place: sets .date/.startTime/.endTime). Tasks that cannot fit
  // are returned in `overflow` for the caller to push to the next day.
  function layoutDay(store, dateStr, tasksForDay) {
    const win = workingWindow(store, dateStr);
    const windowStart = timeToMinutes(win.start);
    const windowEnd = timeToMinutes(win.end);

    const ranked = [...tasksForDay].sort(compareRank);
    const placed = [];
    const overflow = [];

    for (const task of ranked) {
      const dur = durationMinutes(task);
      const preferred = Math.max(timeToMinutes(task.startTime), windowStart);
      const slot = findSlot(placed, preferred, windowEnd, dur);
      if (slot === null) {
        overflow.push(task);
        continue;
      }
      task._startMin = slot;
      task._endMin = slot + dur;
      task.date = dateStr;
      task.startTime = minutesToTime(slot);
      task.endTime = minutesToTime(slot + dur);
      placed.push(task);
    }
    return { placed, overflow };
  }

  // Cascade: place tasksForDay on dateStr; anything that overflows is carried
  // to dateStr+1 and merged with whatever is already anchored there, and so
  // on, capped to avoid runaway loops.
  function cascade(store, dateStr, tasksForDay) {
    const touched = new Set();
    let currentDate = dateStr;
    let pending = tasksForDay;
    let hops = 0;
    const allPlaced = [];

    while (pending.length && hops++ < 60) {
      const existing = store.getTasksOnDate(currentDate)
        .filter(t => !t.completed && !pending.some(p => p.id === t.id));
      const { placed, overflow } = layoutDay(store, currentDate, [...existing, ...pending]);
      allPlaced.push(...placed);
      touched.add(currentDate);
      if (!overflow.length) break;
      pending = overflow;
      currentDate = addDays(currentDate, 1);
    }
    store.markDirty();
    return { touched: [...touched], placed: allPlaced, strandedCount: pending.length };
  }

  // Public: user dropped/resized a task onto (dateStr, startTime, endTime).
  // The moved task becomes the manual anchor; neighbors on that day reflow
  // around it, with overflow cascading forward.
  function placeTask(store, taskId, dateStr, startTime, endTime) {
    const task = store.getTask(taskId);
    if (!task) return { touched: [] };
    task.date = dateStr;
    task.startTime = startTime;
    task.endTime = endTime;
    task.manuallyPlaced = true;

    const others = store.getTasksOnDate(dateStr).filter(t => t.id !== taskId && !t.completed);
    return cascade(store, dateStr, [task, ...others]);
  }

  // Public: user ticked "missed" on a task. Find it the next slot at/after
  // now, per hierarchy, cascading forward through days as needed.
  function rescheduleMissed(store, taskId, fromDate) {
    const task = store.getTask(taskId);
    if (!task) return { touched: [] };
    task.missed = false; // clears once rescheduled — it's been handled
    task.manuallyPlaced = false;
    const dur = durationMinutes(task);
    task.date = fromDate;
    // keep original startTime as "preference" for that day's slot search;
    // layoutDay will push it forward if occupied by higher-rank tasks.
    task.endTime = minutesToTime(timeToMinutes(task.startTime) + dur);

    const others = store.getTasksOnDate(fromDate).filter(t => t.id !== taskId && !t.completed);
    return cascade(store, fromDate, [task, ...others]);
  }

  return { layoutDay, cascade, placeTask, rescheduleMissed, workingWindow };
})();

window.Scheduler = Scheduler;
