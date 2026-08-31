// model.js — task shape, priority ranking, recurrence expansion, date/time helpers

const PRIORITY_ORDER = ['urgent', 'immediate', 'not_urgent', 'long_term'];
const PRIORITY_LABEL = {
  urgent: 'Urgent',
  immediate: 'Immediate',
  not_urgent: 'Not urgent',
  long_term: 'Long-term goal'
};
const PRIORITY_RANK = Object.fromEntries(PRIORITY_ORDER.map((p, i) => [p, i]));

const NOTIF_OPTIONS = [
  { value: 0, label: 'At start time' },
  { value: 5, label: '5 minutes before' },
  { value: 10, label: '10 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' }
];

function uid() {
  return 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function pad2(n) { return String(n).padStart(2, '0'); }

function toDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function fromDateStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(dateStr, n) {
  const d = fromDateStr(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  mins = ((mins % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
}

function durationMinutes(task) {
  return timeToMinutes(task.endTime) - timeToMinutes(task.startTime);
}

// Adds `dur` minutes to a same-day startTime WITHOUT wrapping past midnight.
// This app has no concept of a task spanning two calendar days, so a result
// past 24:00 must never be silently wrapped into an earlier clock time (that
// makes durationMinutes go negative and defeats every overflow check).
// Returns null when it doesn't fit today at all — the caller should treat
// that as "this needs to start on a different day."
function addMinutesCapped(startTime, dur) {
  const total = timeToMinutes(startTime) + dur;
  if (total > 24 * 60) return null;
  return minutesToTime(total);
}

const OVERNIGHT_WINDOW_START = '22:00';
const OVERNIGHT_DURATION_MIN = 15; // nominal — overnight tasks have no real closing time

// Blank task factory
function newTask(overrides = {}) {
  const task = {
    id: uid(),
    title: '',
    date: toDateStr(new Date()),
    startTime: '09:00',
    endTime: '10:00',
    deadline: null,        // 'YYYY-MM-DD' or null
    priority: 'not_urgent',
    recurrence: { type: 'none' },
    recurrenceId: null,    // groups instances of the same recurring task
    missed: false,
    completed: false,
    manuallyPlaced: false, // true once user drags it; scheduler treats as anchor
    overnight: false,      // automated/"just hit run" task — no fixed closing
                            // time, always auto-placed in the last hours of the day
    notifications: [30],
    notified: {},          // { leadMinutes: true } — fired-flag per instance
    createdAt: Date.now(),
    ...overrides
  };
  // Overnight tasks always carry a short nominal duration regardless of
  // whatever start/end came in — they have no real closing time, and the
  // scheduler always repositions them into the last hours of the day anyway.
  if (task.overnight) {
    task.endTime = addMinutesCapped(task.startTime, OVERNIGHT_DURATION_MIN) || minutesToTime((timeToMinutes(task.startTime) + OVERNIGHT_DURATION_MIN) % (24 * 60));
  }
  return task;
}

// Rank tuple: lower sorts first (= higher scheduling priority)
// Deadline tasks always outrank non-deadline tasks. Among deadline tasks,
// nearer deadline wins. Among non-deadline tasks, manual priority order wins.
function rankOf(task) {
  if (task.deadline) {
    return [0, fromDateStr(task.deadline).getTime(), PRIORITY_RANK[task.priority] ?? 9];
  }
  return [1, PRIORITY_RANK[task.priority] ?? 9, 0];
}

function compareRank(a, b) {
  const ra = rankOf(a), rb = rankOf(b);
  for (let i = 0; i < ra.length; i++) {
    if (ra[i] !== rb[i]) return ra[i] - rb[i];
  }
  return a.createdAt - b.createdAt;
}

// --- Recurrence expansion ---
// Given a template task (the "master"), generate concrete instance dates
// within [rangeStart, rangeEnd] (inclusive, 'YYYY-MM-DD' strings).
function expandRecurrence(master, rangeStart, rangeEnd) {
  const rec = master.recurrence || { type: 'none' };
  if (!rec.type || rec.type === 'none') {
    return (master.date >= rangeStart && master.date <= rangeEnd) ? [master.date] : [];
  }
  const start = fromDateStr(master.date);
  const rStart = fromDateStr(rangeStart);
  const rEnd = fromDateStr(rangeEnd);
  const endBound = rec.until ? fromDateStr(rec.until) : null;
  const dates = [];
  let cursor = new Date(Math.max(start, rStart));
  // align cursor logic per type below rather than generic stepping
  const cap = 400; // safety
  let count = 0;

  function push(d) {
    if (d < start) return;
    if (endBound && d > endBound) return;
    if (d >= rStart && d <= rEnd) dates.push(toDateStr(d));
  }

  if (rec.type === 'daily') {
    let d = new Date(start);
    while (d <= rEnd && count++ < cap) {
      if (d >= rStart) push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
  } else if (rec.type === 'weekly') {
    // same weekday as start, or explicit weekdays list
    const days = rec.weekdays && rec.weekdays.length ? rec.weekdays : [start.getDay()];
    let d = new Date(start);
    while (d <= rEnd && count++ < cap) {
      if (days.includes(d.getDay())) push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
  } else if (rec.type === 'every_weekday') {
    let d = new Date(start);
    while (d <= rEnd && count++ < cap) {
      if (d.getDay() >= 1 && d.getDay() <= 5) push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
  } else if (rec.type === 'monthly_last') {
    let d = new Date(start.getFullYear(), start.getMonth(), 1);
    while (d <= rEnd && count++ < cap) {
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      push(lastDay);
      d.setMonth(d.getMonth() + 1);
    }
  } else if (rec.type === 'annual') {
    let d = new Date(start);
    while (d <= rEnd && count++ < cap) {
      push(new Date(d));
      d.setFullYear(d.getFullYear() + 1);
    }
  } else if (rec.type === 'custom') {
    const interval = Math.max(1, rec.interval || 1);
    const unit = rec.unit || 'week'; // 'day' | 'week' | 'month'
    let d = new Date(start);
    while (d <= rEnd && count++ < cap) {
      if (unit === 'week' && rec.weekdays && rec.weekdays.length) {
        // step week-by-week, emitting chosen weekdays within each interval week
        const weekStart = new Date(d);
        for (let i = 0; i < 7; i++) {
          const day = new Date(weekStart);
          day.setDate(day.getDate() + i);
          if (rec.weekdays.includes(day.getDay())) push(day);
        }
        d.setDate(d.getDate() + 7 * interval);
      } else if (unit === 'day') {
        push(new Date(d));
        d.setDate(d.getDate() + interval);
      } else {
        push(new Date(d));
        d.setMonth(d.getMonth() + interval);
      }
    }
  }
  return [...new Set(dates)].sort();
}

window.Model = {
  PRIORITY_ORDER, PRIORITY_LABEL, PRIORITY_RANK, NOTIF_OPTIONS,
  OVERNIGHT_WINDOW_START, OVERNIGHT_DURATION_MIN,
  uid, pad2, toDateStr, fromDateStr, addDays,
  timeToMinutes, minutesToTime, durationMinutes, addMinutesCapped,
  newTask, rankOf, compareRank, expandRecurrence
};
