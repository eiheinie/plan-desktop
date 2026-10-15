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
    if (t.details !== undefined && (typeof t.details !== 'string' || t.details.length > 5000)) throw new Error('详情最多 5000 个字。');
    if (typeof t.title !== 'string' || !t.title.trim() || t.title.length > 500) throw new Error('任务内容需要在 1 到 500 个字之间。');
    if (!validDateTime(t.start) || !validDateTime(t.due) || t.start > t.due) throw new Error('请检查开始时间和截止时间。');
    if (typeof t.done !== 'boolean') throw new Error('完成状态有误。');
    return { id: t.id, title: t.title.trim(), ...(t.details !== undefined ? {details:t.details.trim()} : {}), start: t.start, due: t.due, done: t.done };
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
    return { version: 4, dailyTasks: [], revision: 0, tasks: validateTasks(raw.map((t, i) => {
      const due = fromLegacy(t.Due);
      let start = t.Start ? fromLegacy(t.Start) : `${localDate(now)}T00:00`;
      if (!validDateTime(start) || start > due) start = `${due.slice(0,10)}T00:00`;
      return { id: `legacy-${i}`, title: t.Title, due, start, done: !!t.Done };
    })) };
  }
  if (!raw || ![3,4].includes(raw.version) || !Number.isSafeInteger(raw.revision) || raw.revision < 0) throw new Error('任务文件格式无法识别。');
  return { version: 4, revision: raw.revision, tasks: validateTasks(raw.tasks), dailyTasks: validateDailyTasks(raw.version === 3 ? [] : raw.dailyTasks) };
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

export function validateDailyTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length > 1000) throw new Error('每日任务数量或格式有误。');
  const ids = new Set();
  return tasks.map(t => {
    if (!t || typeof t.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(t.id) || ids.has(t.id)) throw new Error('每日任务编号有误。');
    ids.add(t.id);
    if (t.details !== undefined && (typeof t.details !== 'string' || t.details.length > 5000)) throw new Error('详情最多 5000 个字。');
    if (typeof t.title !== 'string' || !t.title.trim() || t.title.length > 500) throw new Error('任务内容需要在 1 到 500 个字之间。');
    if (typeof t.time !== 'string' || (t.time !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.time))) throw new Error('请检查每日截止时间。');
    if (!Array.isArray(t.completedDates) || t.completedDates.length > 10000 || t.completedDates.some(d => typeof d !== 'string' || !validDateTime(`${d}T00:00`))) throw new Error('每日完成记录有误。');
    return { id: t.id, title: t.title.trim(), ...(t.details !== undefined ? {details:t.details.trim()} : {}), time: t.time, completedDates: [...new Set(t.completedDates)].sort() };
  });
}
export function dailyDone(task, day = localDate()) { return task.completedDates.includes(day); }
export function toggleDaily(task, day = localDate()) {
  return { ...task, completedDates: dailyDone(task, day) ? task.completedDates.filter(d => d !== day) : [...task.completedDates, day] };
}

export function isOverdue(task, now = new Date()) {
  return !task.done && new Date(task.due).getTime() < now.getTime();
}
export function isDailyOverdue(task, now = new Date()) {
  return !!task.time && !dailyDone(task, localDate(now)) && new Date(`${localDate(now)}T${task.time}`).getTime() < now.getTime();
}
