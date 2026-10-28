import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('计划安装程序\n\nnode install.mjs [--dir "E:\\计划"] [--autostart]\n\n--dir        安装文件夹，默认位于当前用户的本地应用目录\n--autostart  开启当前用户的开机自启动；不指定时保留现有设置\n\n安装后双击桌面上的「计划」。任务数据保存在安装目录的 data 文件夹。');
} else {
  main().catch(error => { console.error('安装未完成：' + error.message); process.exitCode = 1; });
}

async function main() {
  if (process.platform !== 'win32') throw new Error('桌面安装程序仅支持 Windows。');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('请使用 Node.js 22 或更高版本。');
  let destination = path.join(process.env.LOCALAPPDATA || source, 'PlanDesktop'), autostart = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir') { if (!args[i+1] || args[i+1].startsWith('--')) throw new Error('--dir 后需要填写安装目录。'); destination = args[++i]; }
    else if (args[i] === '--autostart') autostart = true;
    else throw new Error('未知选项：' + args[i]);
  }
  destination = path.resolve(destination);
  const files = ['index.html','app.mjs','model.mjs','server.mjs','style.css','icon.svg','plan.ico','theme-warm.png','README.md','package.json'];
  for (const file of files) if (!fs.existsSync(path.join(source, file))) throw new Error('发布包缺少文件：' + file);
  fs.mkdirSync(path.join(destination, 'runtime'), { recursive: true });
  const executable = path.join(destination, 'runtime', 'node.exe');
  if (path.resolve(process.execPath).toLowerCase() !== executable.toLowerCase()) {
    const hash = filename => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
    if (!fs.existsSync(executable) || hash(executable) !== hash(process.execPath)) fs.copyFileSync(process.execPath, executable);
  }
  if (source.toLowerCase() !== destination.toLowerCase()) for (const file of files) fs.copyFileSync(path.join(source, file), path.join(destination, file));
  // Dynamic paths arrive over stdin as JSON; they are never inserted into shell code.
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path $desktop '计划.lnk'))
$shortcut.TargetPath = $request.executable
$shortcut.Arguments = '"' + $request.script + '"'
$shortcut.WorkingDirectory = $request.directory
$shortcut.IconLocation = Join-Path $request.directory 'plan.ico'
$shortcut.WindowStyle = 7
$shortcut.Description = '计划 - 本地任务与日期跨度'
$shortcut.Save()
if ($request.autostart) {
  $runKey = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
  if (-not (Test-Path -LiteralPath $runKey)) { New-Item -Path $runKey -Force | Out-Null }
  Set-ItemProperty -LiteralPath $runKey -Name 'DailyPlanDesktop' -Value ('"' + $request.executable + '" "' + $request.script + '"')
}
`;
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  await new Promise((resolve, reject) => {
    const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe','ignore','pipe'] });
    let errorText = ''; child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => errorText += chunk);
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(errorText.trim() || '无法创建桌面快捷方式。')));
    child.stdin.on('error', reject);
    child.stdin.end(JSON.stringify({ executable, script: path.join(destination,'server.mjs'), directory: destination, autostart }));
  });
  console.log('安装完成：' + destination + '\n现在可以双击桌面上的「计划」。\n任务数据保存在：' + path.join(destination,'data'));
}
