import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { migrate, validateTasks } from './model.mjs';

const exec = promisify(execFile);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const PORT = 17643;
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const REG = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
const marker = 'plan-browser-v3';
export const startup = {
  async get() {
    try { const { stdout } = await exec(REG, ['query', RUN_KEY, '/v', 'DailyPlanDesktop'], { windowsHide: true }); return /REG_SZ/.test(stdout); }
    catch (e) { if (e.code === 1) return false; throw new Error('无法读取开机自启动设置。'); }
  },
  async set(enabled) {
    if (enabled) await exec(REG, ['add', RUN_KEY, '/v', 'DailyPlanDesktop', '/t', 'REG_SZ', '/d', `"${process.execPath}" "${path.join(ROOT, 'server.mjs')}"`, '/f'], { windowsHide: true });
    else if (await this.get()) await exec(REG, ['delete', RUN_KEY, '/v', 'DailyPlanDesktop', '/f'], { windowsHide: true });
    return this.get();
  }
};
export function createPlanServer({ root = ROOT, dataDir = path.join(root, 'data'), port = PORT, startupAdapter = startup } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const filename = path.join(dataDir, 'tasks.json');
  let state = { version: 3, revision: 0, tasks: [] }, readOnly = false, warning = '';
  if (fs.existsSync(filename)) {
    try { state = migrate(JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''))); }
    catch (e) {
      try { state = migrate(JSON.parse(fs.readFileSync(filename + '.bak', 'utf8').replace(/^\uFEFF/, ''))); fs.copyFileSync(filename, filename + '.damaged-' + Date.now()); warning = '主任务文件读取失败，已恢复上一次备份；原文件仍保留。'; }
      catch { readOnly = true; warning = '任务文件无法读取，已停止保存以保护原数据。请保留 data 文件夹。'; }
    }
  }
  const token = crypto.randomBytes(32).toString('hex');
  const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
  const allowed = new Set(['index.html', 'app.mjs', 'model.mjs', 'style.css', 'icon.svg', 'plan.ico']);
  const server = http.createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      if (req.headers.host !== `127.0.0.1:${server.address().port}` || (req.headers.origin && req.headers.origin !== origin)) return json(403, { error: '请求来源不受支持。' });
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && url.pathname === '/health') return json(200, { app: marker, root });
      if (req.method === 'GET' && url.pathname === '/api/state') {
        let autostart = false, startupError = '';
        try { autostart = await startupAdapter.get(); } catch (e) { startupError = e.message; }
        return json(200, { ...state, autostart, startupError, readOnly, warning, token, dataPath: dataDir });
      }
      if (req.method === 'POST' && (url.pathname === '/api/tasks' || url.pathname === '/api/startup')) {
        if (req.headers['x-plan-token'] !== token || req.headers['content-type']?.split(';')[0] !== 'application/json') return json(403, { error: '请求验证失败，请刷新页面。' });
        let bytes = 0, chunks = [];
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) return json(413, { error: '任务数据过大。' }); chunks.push(chunk); }
        let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json(400, { error: '数据格式有误。' }); }
        if (url.pathname === '/api/startup') {
          if (typeof body.enabled !== 'boolean') return json(400, { error: '自启动选项有误。' });
          return json(200, { autostart: await startupAdapter.set(body.enabled) });
        }
        if (readOnly) return json(423, { error: warning });
        if (body.revision !== state.revision) return json(409, { error: '另一个窗口已修改任务，请刷新后重试。' });
        let tasks; try { tasks = validateTasks(body.tasks); } catch (e) { return json(400, { error: e.message }); }
        const next = { version: 3, revision: state.revision + 1, tasks };
        const temp = filename + '.tmp';
        const fd = fs.openSync(temp, 'w'); try { fs.writeFileSync(fd, JSON.stringify(next, null, 2), 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        if (fs.existsSync(filename)) { if (state.revision === 0 && !fs.existsSync(filename + '.legacy')) fs.copyFileSync(filename, filename + '.legacy'); if (!warning) fs.copyFileSync(filename, filename + '.bak'); }
        fs.renameSync(temp, filename); state = next; warning = '';
        return json(200, { revision: state.revision });
      }
      if (req.method !== 'GET') return json(405, { error: '不支持此操作。' });
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!allowed.has(file)) return json(404, { error: '未找到页面。' });
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] }); fs.createReadStream(path.join(root, file)).pipe(res);
    } catch (e) { if (!res.headersSent) json(500, { error: '操作失败：' + e.message }); else res.end(); }
  });
  server.requestTimeout = 15000;
  return server;
}
function browserPath() {
  const paths = [path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe')];
  const browser = paths.find(p => fs.existsSync(p)); if (!browser) throw new Error('未找到 Edge 或 Chrome 浏览器。'); return browser;
}
async function health() { try { const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(800) }); return await r.json(); } catch { return null; } }
async function main() {
  if (process.argv.includes('--serve')) {
    const server = createPlanServer();
    server.on('error', e => { fs.appendFileSync(path.join(ROOT, 'service.log'), `${new Date().toISOString()} ${e.message}\n`); process.exit(1); });
    server.listen(PORT, '127.0.0.1'); return;
  }
  if (process.argv.includes('--enable-startup')) { await startup.set(true); return; }
  let current = await health();
  if (current && (current.app !== marker || path.resolve(current.root) !== path.resolve(ROOT))) throw new Error(`端口 ${PORT} 已被其他程序占用。`);
  if (!current) {
    const child = spawn(process.execPath, [path.join(ROOT, 'server.mjs'), '--serve'], { detached: true, windowsHide: true, stdio: 'ignore', cwd: ROOT }); child.unref();
    for (let i=0; i<40; i++) { await new Promise(r=>setTimeout(r,150)); current = await health(); if (current?.app === marker) break; }
  }
  if (!current || current.app !== marker) throw new Error('本地服务没有启动，请查看 service.log。');
  if (!process.argv.includes('--no-open')) {
    const browser = spawn(browserPath(), [`--app=http://127.0.0.1:${PORT}/`, '--window-size=1320,900'], { detached: true, stdio: 'ignore', windowsHide: false });
    browser.on('error', e => fs.appendFileSync(path.join(ROOT, 'service.log'), `${new Date().toISOString()} Browser: ${e.message}\n`));
    browser.unref();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => {
  fs.appendFileSync(path.join(ROOT, 'service.log'), `${new Date().toISOString()} ${e.stack}\n`); process.exitCode = 1;
});
