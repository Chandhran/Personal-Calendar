// store.js — persistence. Local in-memory + localStorage cache, synced to a
// JSON file in a GitHub repo of the user's choice via the GitHub REST API.

const Store = (() => {
  const LS_KEY = 'cal_app_data_v1';
  const LS_CFG = 'cal_app_github_cfg_v1';

  let state = {
    tasks: [],            // flattened concrete instances (recurring masters expanded lazily)
    masters: [],          // recurring task templates
    workingHours: {},     // dateStr -> {start, end}
    meta: { sha: null }   // last known GitHub file sha, for safe commits
  };

  let cfg = { owner: '', repo: '', path: 'calendar-data.json', token: '', branch: 'main' };
  let dirty = false;
  let syncTimer = null;

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) state = JSON.parse(raw);
    } catch (e) { /* ignore corrupt cache */ }
    try {
      const rawCfg = localStorage.getItem(LS_CFG);
      if (rawCfg) cfg = { ...cfg, ...JSON.parse(rawCfg) };
    } catch (e) { /* ignore */ }
  }

  function saveLocal() {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }

  function saveCfg() {
    localStorage.setItem(LS_CFG, JSON.stringify(cfg));
  }

  function isConfigured() {
    return !!(cfg.owner && cfg.repo && cfg.token);
  }

  function setConfig(next) {
    cfg = { ...cfg, ...next };
    saveCfg();
  }

  function getConfig() {
    return { ...cfg, token: cfg.token ? '••••••••' : '' };
  }

  function markDirty() {
    dirty = true;
    saveLocal();
    scheduleSync();
  }

  function scheduleSync(delay = 4000) {
    if (!isConfigured()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncToGitHub, delay);
  }

  async function ghRequest(method, body) {
    const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(cfg.path)}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/vnd.github+json'
      },
      body: body ? JSON.stringify(body) : undefined
    });
    return res;
  }

  async function pullFromGitHub() {
    if (!isConfigured()) return { ok: false, reason: 'not_configured' };
    try {
      const res = await ghRequest('GET');
      if (res.status === 404) return { ok: true, empty: true };
      if (!res.ok) return { ok: false, reason: `http_${res.status}` };
      const json = await res.json();
      const content = decodeURIComponent(escape(atob(json.content.replace(/\n/g, ''))));
      const remote = JSON.parse(content);
      state = { tasks: remote.tasks || [], masters: remote.masters || [], workingHours: remote.workingHours || {}, meta: { sha: json.sha } };
      saveLocal();
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  async function syncToGitHub() {
    if (!isConfigured() || !dirty) return { ok: false, reason: dirty ? 'not_configured' : 'nothing_to_sync' };
    try {
      const payload = { tasks: state.tasks, masters: state.masters, workingHours: state.workingHours };
      const content = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))));
      const body = {
        message: `Update schedule — ${new Date().toISOString()}`,
        content,
        branch: cfg.branch
      };
      if (state.meta.sha) body.sha = state.meta.sha;
      const res = await ghRequest('PUT', body);
      if (!res.ok) {
        const errText = await res.text();
        document.dispatchEvent(new CustomEvent('sync-error', { detail: `GitHub sync failed (${res.status}): ${errText.slice(0, 200)}` }));
        return { ok: false, reason: `http_${res.status}` };
      }
      const json = await res.json();
      state.meta.sha = json.content.sha;
      dirty = false;
      saveLocal();
      document.dispatchEvent(new CustomEvent('sync-ok'));
      return { ok: true };
    } catch (e) {
      document.dispatchEvent(new CustomEvent('sync-error', { detail: e.message }));
      return { ok: false, reason: e.message };
    }
  }

  // --- task CRUD ---
  function getTask(id) {
    return state.tasks.find(t => t.id === id);
  }
  function getTasksOnDate(dateStr) {
    return state.tasks.filter(t => t.date === dateStr);
  }
  function getTasksInRange(startStr, endStr) {
    return state.tasks.filter(t => t.date >= startStr && t.date <= endStr);
  }
  function addTask(task) {
    state.tasks.push(task);
    markDirty();
    return task;
  }
  function addMaster(master) {
    state.masters.push(master);
    markDirty();
    return master;
  }
  function getMasters() { return state.masters; }
  function updateTask(id, patch) {
    const t = getTask(id);
    if (!t) return null;
    Object.assign(t, patch);
    markDirty();
    return t;
  }
  function removeTask(id) {
    state.tasks = state.tasks.filter(t => t.id !== id);
    markDirty();
  }
  function removeSeries(recurrenceId) {
    state.tasks = state.tasks.filter(t => t.recurrenceId !== recurrenceId);
    state.masters = state.masters.filter(m => m.recurrenceId !== recurrenceId);
    markDirty();
  }
  function setWorkingHours(dateStr, win) {
    if (win) state.workingHours[dateStr] = win;
    else delete state.workingHours[dateStr];
    markDirty();
  }
  function getWorkingHours(dateStr) {
    return state.workingHours[dateStr] || null;
  }

  function ensureRecurringInstances(rangeStart, rangeEnd) {
    for (const master of state.masters) {
      const dates = window.Model.expandRecurrence(master, rangeStart, rangeEnd);
      for (const d of dates) {
        // Match on originalDate (the date this occurrence was generated
        // for), not the current .date field — the reflow engine can move an
        // instance to a different day when it needs to reschedule it, and
        // matching on .date would then see day `d` as "missing" and
        // generate a duplicate, leaving the moved instance behind as a
        // second copy.
        const already = state.tasks.some(t => t.recurrenceId === master.recurrenceId && (t.originalDate || t.date) === d);
        if (!already) {
          const dur = window.Model.durationMinutes(master);
          state.tasks.push(window.Model.newTask({
            ...master,
            id: window.Model.uid(),
            date: d,
            originalDate: d,
            endTime: window.Model.minutesToTime(window.Model.timeToMinutes(master.startTime) + dur),
            recurrence: { type: 'none' }, // instances themselves don't recurse
            recurrenceId: master.recurrenceId
          }));
        }
      }
    }
  }

  // Split a recurring series at `instanceId`: the old series stops the day
  // before this occurrence, and a new series starts here with `edits`
  // applied, continuing the same recurrence pattern. Used for "this and
  // following events" edits.
  function splitSeriesFrom(instanceId, edits) {
    const inst = getTask(instanceId);
    if (!inst || !inst.recurrenceId) return null;
    const oldRecId = inst.recurrenceId;
    const splitDate = inst.originalDate || inst.date;
    const oldMaster = state.masters.find(m => m.recurrenceId === oldRecId);

    if (oldMaster) {
      oldMaster.recurrence = { ...oldMaster.recurrence, until: window.Model.addDays(splitDate, -1) };
    }
    // Drop every materialized instance of the OLD series from the split
    // point on (including the one being edited) — the new series replaces
    // them going forward.
    state.tasks = state.tasks.filter(t => !(t.recurrenceId === oldRecId && (t.originalDate || t.date) >= splitDate));

    const newRecId = window.Model.uid();
    const pattern = oldMaster ? { ...oldMaster.recurrence } : { type: 'none' };
    delete pattern.until;
    const newMaster = window.Model.newTask({
      title: inst.title, priority: inst.priority, deadline: inst.deadline, notifications: inst.notifications,
      startTime: inst.startTime, endTime: inst.endTime,
      ...edits,
      date: splitDate,
      recurrence: pattern,
      recurrenceId: newRecId
    });
    state.masters.push(newMaster);
    markDirty();
    return newMaster;
  }

  // --- undo support ---
  function getSnapshot() {
    return JSON.parse(JSON.stringify({ tasks: state.tasks, masters: state.masters, workingHours: state.workingHours }));
  }
  function restoreSnapshot(snap) {
    state.tasks = snap.tasks;
    state.masters = snap.masters;
    state.workingHours = snap.workingHours;
    markDirty();
  }

  loadLocal();

  return {
    isConfigured, setConfig, getConfig,
    pullFromGitHub, syncToGitHub, scheduleSync,
    getTask, getTasksOnDate, getTasksInRange,
    addTask, addMaster, getMasters, updateTask, removeTask, removeSeries,
    setWorkingHours, getWorkingHours,
    ensureRecurringInstances, splitSeriesFrom,
    getSnapshot, restoreSnapshot,
    markDirty
  };
})();

window.Store = Store;
