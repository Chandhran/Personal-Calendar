// history.js — a simple undo stack for the whole app. Call History.record()
// right before any user-initiated mutation; History.undo() restores the last
// snapshot. Redo is intentionally not implemented — reverting further with
// undo again is how you go back multiple steps.

const History = (() => {
  const stack = [];
  const MAX = 50;

  function record() {
    stack.push(window.Store.getSnapshot());
    if (stack.length > MAX) stack.shift();
  }

  function undo() {
    if (!stack.length) return false;
    const snap = stack.pop();
    window.Store.restoreSnapshot(snap);
    return true;
  }

  function canUndo() { return stack.length > 0; }

  return { record, undo, canUndo };
})();

window.History = History;
