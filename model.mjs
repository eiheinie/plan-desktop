export const pad = n => String(n).padStart(2, '0');
export function localDate(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
export function localTime(d = new Date()) { return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
export function validDateTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const d = new Date(value);
  return Number.isFinite(+d) && localTime(d) === value && d.getFullYear() >= 1900 && d.getFullYear() <= 9998;
}
export function validateTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length > 10000) throw new Error('任务数量或格式有误。');
  const ids = new Set();
  return tasks.map(t => {
    if (!t || typeof t.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(t.id) || ids.has(t.id)) throw new Error('任务编号有误。');
    ids.add(t.id);
    if (typeof t.title !== 'string' || !t.title.trim() || t.title.length > 500) throw new Error('任务内容需要在 1 到 500 个字之间。');
    if (!validDateTime(t.start) || !validDateTime(t.due) || t.start > t.due) throw new Error('请检查开始时间和截止时间。');
    if (typeof t.done !== 'boolean') throw new Error('完成状态有误。');
    return { id: t.id, title: t.title.trim(), start: t.start, due: t.due, done: t.done };
  });
}
function fromLegacy(value) {
  if (typeof value === 'string' && value.startsWith('/Date(')) {
    const m = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value);
    if (!m) throw new Error('旧任务日期无法解析。');
    return localTime(new Date(Number(m[1])));
  }
  if (validDateTime(value)) return value;
  const d = new Date(value);
  if (!Number.isFinite(+d)) throw new Error('旧任务日期无法解析。');
  return localTime(d);
}
export function migrate(raw, now = new Date()) {
  if (Array.isArray(raw)) {
    return { version: 3, revision: 0, tasks: validateTasks(raw.map((t, i) => {
      const due = fromLegacy(t.Due);
      let start = t.Start ? fromLegacy(t.Start) : `${localDate(now)}T00:00`;
      if (!validDateTime(start) || start > due) start = `${due.slice(0,10)}T00:00`;
      return { id: `legacy-${i}`, title: t.Title, due, start, done: !!t.Done };
    })) };
  }
  if (!raw || raw.version !== 3 || !Number.isSafeInteger(raw.revision) || raw.revision < 0) throw new Error('任务文件格式无法识别。');
  return { version: 3, revision: raw.revision, tasks: validateTasks(raw.tasks) };
}
export function monthSpan(task, year, month) {
  const first = `${year}-${pad(month+1)}-01`;
  const days = new Date(year, month+1, 0).getDate();
  const last = `${year}-${pad(month+1)}-${pad(days)}`;
  const start = task.start.slice(0,10), end = task.due.slice(0,10);
  if (end < first || start > last) return null;
  return { first: start < first ? 0 : Number(start.slice(8))-1, last: end > last ? days-1 : Number(end.slice(8))-1, before: start < first, after: end > last };
}
export function reorder(tasks, id, targetId, after = false) {
  if (id === targetId) return tasks.slice();
  const next = tasks.slice(), from = next.findIndex(t => t.id === id);
  if (from < 0) return next;
  const [item] = next.splice(from, 1);
  const to = next.findIndex(t => t.id === targetId);
  next.splice(to < 0 ? next.length : to + (after ? 1 : 0), 0, item);
  return next;
}
