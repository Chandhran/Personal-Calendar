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
  const { timeToMinutes, minutesToTime, durationMinutes, compareRank, addDays, toDateStr } = window.Model;

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
  // `unboundedId`, if given, marks one task (the one the user just
  // dragged/resized/typed a time for) as exempt from the working-hours
  // window — manual placement always wins exactly where the user put it.
  // Only the *other* tasks displaced around it stay bounded by the window.
  function layoutDay(store, dateStr, tasksForDay, unboundedId) {
    const win = workingWindow(store, dateStr);
    const windowStart = timeToMinutes(win.start);
    const windowEnd = timeToMinutes(win.end);

    let rest = tasksForDay;
    const placed = [];
    const overflow = [];

    if (unboundedId) {
      const anchor = tasksForDay.find(t => t.id === unboundedId);
      rest = tasksForDay.filter(t => t.id !== unboundedId);
      if (anchor) {
        const dur = durationMinutes(anchor);
        const start = timeToMinutes(anchor.startTime); // exact — not clamped to the window
        anchor._startMin = start;
        anchor._endMin = start + dur;
        anchor.date = dateStr;
        placed.push(anchor);
      }
    }

    const ranked = [...rest].sort(compareRank);

    for (const task of ranked) {
      const dur = durationMinutes(task);
      // A task the user has manually placed at some point stays exempt from
      // the working-hours window even on later reflows (e.g. when a new
      // higher-rank task is dropped nearby and neighbors get re-laid-out) —
      // only auto-scheduled tasks are bound by the window.
      const isFree = !!task.manuallyPlaced;
      const effStart = isFree ? 0 : windowStart;
      const effEnd = isFree ? 24 * 60 : windowEnd;
      const preferred = Math.max(timeToMinutes(task.startTime), effStart);
      const slot = findSlot(placed, preferred, effEnd, dur);
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
  // on, capped to avoid runaway loops. `unboundedId` (if any) only applies on
  // the first day — the anchor itself never overflows since it isn't bounded.
  function cascade(store, dateStr, tasksForDay, unboundedId) {
    const touched = new Set();
    let currentDate = dateStr;
    let pending = tasksForDay;
    let hops = 0;
    let firstPass = true;
    const allPlaced = [];

    while (pending.length && hops++ < 60) {
      const existing = store.getTasksOnDate(currentDate)
        .filter(t => !t.completed && !pending.some(p => p.id === t.id));
      const { placed, overflow } = layoutDay(store, currentDate, [...existing, ...pending], firstPass ? unboundedId : null);
      allPlaced.push(...placed);
      touched.add(currentDate);
      firstPass = false;
      if (!overflow.length) break;
      pending = overflow;
      currentDate = addDays(currentDate, 1);
    }
    store.markDirty();
    return { touched: [...touched], placed: allPlaced, strandedCount: pending.length };
  }

  // Public: user dropped/resized/typed a time for a task onto (dateStr,
  // startTime, endTime). This is manual placement — it lands exactly there,
  // even outside the day's working-hours window. Neighbors on that day
  // reflow around it (bounded by the window), with overflow cascading
  // forward.
  function placeTask(store, taskId, dateStr, startTime, endTime) {
    const task = store.getTask(taskId);
    if (!task) return { touched: [] };
    task.date = dateStr;
    task.startTime = startTime;
    task.endTime = endTime;
    task.manuallyPlaced = true;

    const others = store.getTasksOnDate(dateStr).filter(t => t.id !== taskId && !t.completed);
    return cascade(store, dateStr, [task, ...others], taskId);
  }

  // Public: user ticked "missed" on a task. Marking something "not done" is
  // an action taken right now, so the task always gets re-anchored from the
  // current moment forward on today's date — not just when its original
  // time has technically already passed. (For a task on a different date,
  // there's no "now" on that date to anchor to, so it reflows using its own
  // time as the starting preference instead.)
  function rescheduleMissed(store, taskId, fromDate) {
    const task = store.getTask(taskId);
    if (!task) return { touched: [] };
    task.missed = false; // clears once rescheduled — it's been handled
    task.manuallyPlaced = false;
    const dur = durationMinutes(task);

    const todayStr = toDateStr(new Date());
    if (fromDate === todayStr) {
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      task.startTime = minutesToTime(Math.ceil(nowMin / 15) * 15);
    }
    task.date = fromDate;
    // keep (possibly re-anchored) startTime as "preference" for that day's
    // slot search; layoutDay will push it forward further if occupied by
    // higher-rank tasks.
    task.endTime = minutesToTime(timeToMinutes(task.startTime) + dur);

    const others = store.getTasksOnDate(fromDate).filter(t => t.id !== taskId && !t.completed);
    return cascade(store, fromDate, [task, ...others]);
  }

  return { layoutDay, cascade, placeTask, rescheduleMissed, workingWindow };
})();

window.Scheduler = Scheduler;
