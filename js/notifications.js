// notifications.js — desktop notifications at configurable lead times.
// Fires while the app/PWA is open or backgrounded (service worker keeps the
// tab's timers alive a bit longer, but a fully closed browser cannot notify —
// there is no server to push from, by design, since this is a static app).

const Notifier = (() => {
  let checkTimer = null;

  async function requestPermission() {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'default') {
      return await Notification.requestPermission();
    }
    return Notification.permission;
  }

  function fire(task, leadLabel) {
    if (Notification.permission !== 'granted') return;
    const body = leadLabel ? `${leadLabel} — ${task.startTime}` : `Starting now`;
    const n = new Notification(task.title || 'Untitled task', {
      body,
      tag: task.id + '_' + leadLabel,
      icon: 'icons/icon.svg'
    });
    n.onclick = () => window.focus();
  }

  function checkDue() {
    const now = new Date();
    const todayStr = window.Model.toDateStr(now);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const tasks = window.Store.getTasksOnDate(todayStr);
    for (const task of tasks) {
      if (task.completed) continue;
      const startMin = window.Model.timeToMinutes(task.startTime);
      for (const lead of (task.notifications || [])) {
        const fireAt = startMin - lead;
        const key = String(lead);
        if (!task.notified) task.notified = {};
        if (task.notified[key]) continue;
        if (nowMin >= fireAt && nowMin <= fireAt + 1) {
          const opt = window.Model.NOTIF_OPTIONS.find(o => o.value === lead);
          fire(task, opt ? opt.label : `${lead} min before`);
          task.notified[key] = true;
          window.Store.markDirty();
        }
      }
    }
  }

  function start() {
    if (checkTimer) return;
    checkTimer = setInterval(checkDue, 30000);
    checkDue();
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* non-fatal */ });
    }
  }

  return { requestPermission, start, registerServiceWorker };
})();

window.Notifier = Notifier;
