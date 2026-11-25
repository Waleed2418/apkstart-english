#!/usr/bin/env node
/*
 * Applies the English interface layer to an ApkStart 0.6.3-0.6.4 app tree.
 *
 * Usage:
 *   node patch/apply.js "C:\path\to\ApkStartEN"   # copied Microsoft Store build
 *   node patch/apply.js "C:\path\to\apkstart"     # local source checkout
 *
 * The target is auto-detected:
 *   - resources\app\src\main.js -> the parent is a copied Store app ("packaged")
 *   - src\main.js               -> the target itself is a source checkout
 * The script is idempotent: running it twice is safe.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const ROOT = path.resolve(process.argv[2] || 'C:\\Users\\Wsali\\ApkStartEN');

function detectLayout(root) {
  if (fs.existsSync(path.join(root, 'resources', 'app', 'src', 'main.js'))) {
    return { app: path.join(root, 'resources', 'app'), mode: 'packaged' };
  }
  if (fs.existsSync(path.join(root, 'src', 'main.js'))) {
    return { app: root, mode: 'source' };
  }
  return null;
}

const layout = detectLayout(ROOT);
if (!layout) {
  console.error('ERROR: ' + ROOT + ' is neither a copied Store app '
    + '(resources\\app\\src\\main.js) nor an apkstart source checkout (src\\main.js).');
  process.exit(1);
}

const APP = layout.app;
const PACKAGED = layout.mode === 'packaged';
const problems = [];
const done = [];

function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, s) { fs.writeFileSync(p, s, 'utf8'); }

function replaceOnce(rel, label, from, to) {
  const file = path.join(APP, rel);
  if (!fs.existsSync(file)) { problems.push(rel + ': file missing'); return; }
  let s = read(file);
  if (s.includes(to)) { done.push(label + ' (already applied)'); return; }
  if (!s.includes(from)) { problems.push(label + ': anchor not found in ' + rel); return; }
  s = s.split(from).join(to);
  write(file, s);
  done.push(label);
}

function copyFile(srcRel, dstRel) {
  const dst = path.join(APP, dstRel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO, srcRel), dst);
  done.push('copied ' + dstRel);
}

// 1. Translation layer files -------------------------------------------------
for (const f of ['en-data.js', 'en-merged.json', 'i18n-core.js', 'i18n-dom.js', 'i18n-main.js']) {
  copyFile(path.join('i18n', f), path.join('i18n', f));
}

// 2. Static manual (English text written into the HTML) ----------------------
const manualPath = path.join(APP, 'src', 'ui', 'manual.html');
const manualZhPath = path.join(APP, 'src', 'ui', 'manual.zh.html');
if (fs.existsSync(manualPath) && !fs.existsSync(manualZhPath)) {
  fs.copyFileSync(manualPath, manualZhPath);
  done.push('backed up original manual.html -> manual.zh.html');
}
copyFile(path.join('i18n', 'manual.en.html'), path.join('src', 'ui', 'manual.html'));

// 3. Load the renderer overlay before each page's own script -----------------
const htmlTargets = [
  ['src/ui/index.html', '<script src="app.js"></script>'],
  ['src/ui/shell.html', '<script src="shell.js"></script>'],
  ['src/ui/splash.html', '<script src="splash.js"></script>'],
];
const overlay = '<script src="../../i18n/en-data.js"></script>\n'
  + '<script src="../../i18n/i18n-core.js"></script>\n'
  + '<script src="../../i18n/i18n-dom.js"></script>\n';
for (const [rel, marker] of htmlTargets) {
  const file = path.join(APP, rel);
  if (!fs.existsSync(file)) { problems.push(rel + ': file missing'); continue; }
  let s = read(file);
  if (s.includes('i18n/en-data.js')) { done.push(rel + ' (already applied)'); continue; }
  if (!s.includes(marker)) { problems.push(rel + ': script marker missing'); continue; }
  s = s.replace(marker, overlay + marker);
  write(file, s);
  done.push(rel + ' scripts');
}

// 4. Main process ------------------------------------------------------------
replaceOnce('src/main.js', 'main.js loads i18n-main',
  "const path = require('path');\n",
  "const path = require('path');\nrequire('../i18n/i18n-main');\n");

if (PACKAGED) {
  replaceOnce('src/main.js', 'main.js separate userData dir',
    "const manual = require('./core/manual');\n",
    "const manual = require('./core/manual');\n"
    + "app.setPath('userData', path.join(app.getPath('appData'), 'ApkStartEN'));\n");
}

// 5. Share the Store data directory so apps and settings stay in one place ---
// A source checkout already uses %APPDATA%\apkstart, so leave its data and
// runtime layout alone. The copied Store app must opt into the shared folder.
if (PACKAGED) {
  replaceOnce('src/core/store.js', 'store.js shared data dir',
    "const DATA_DIR = STORE_BUILD\n"
    + "  ? path.join(os.homedir(), 'ApkStart', 'data')\n"
    + "  : path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'apkstart');",
    "const SHARED_DATA_DIR = path.join(os.homedir(), 'ApkStart', 'data');\n"
    + "const DATA_DIR = (STORE_BUILD || fs.existsSync(SHARED_DATA_DIR))\n"
    + "  ? SHARED_DATA_DIR\n"
    + "  : path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'apkstart');");
}

// 6. Diagnostics summary -----------------------------------------------------
replaceOnce('src/core/doctor.js', 'doctor.js DLL title',
  "title: '运行时依赖 DLL 加载失败（具体原因待定位）',",
  "title: 'Runtime dependency DLL failed to load (exact cause still unknown)',");

replaceOnce('src/core/doctor.js', 'doctor.js profile summary',
  "  return `自动：${(p.memoryMB / 1024).toFixed(1)}GB 内存 · ${p.cores} 核 · ${p.gpu} 渲染 · `\n"
  + "    + `${p.accelOk ? '硬件加速' : '软件模拟'} · ${p.snapshot ? '按需快照' : '冷启动'}`\n"
  + "    + `${p.lite ? ' · 轻量容器' : ''} · 端口 ${p.port}`;",
  "  return `Auto: ${(p.memoryMB / 1024).toFixed(1)}GB RAM · ${p.cores} cores · ${p.gpu} rendering · `\n"
  + "    + `${p.accelOk ? 'hardware acceleration' : 'software emulation'} · ${p.snapshot ? 'snapshots on demand' : 'cold start'}`\n"
  + "    + `${p.lite ? ' · lightweight container' : ''} · port ${p.port}`;");

// 7. Renderer strings that are rebuilt with innerHTML ------------------------
const appJs = [
  ["if (d < 60000) return '刚刚';", "if (d < 60000) return 'just now';"],
  ["if (d < 3600000) return `${Math.floor(d / 60000)} 分钟前`;", "if (d < 3600000) return `${Math.floor(d / 60000)} min ago`;"],
  ["if (d < 86400000) return `${Math.floor(d / 3600000)} 小时前`;", "if (d < 86400000) return `${Math.floor(d / 3600000)} h ago`;"],
  ["if (d < 86400000 * 30) return `${Math.floor(d / 86400000)} 天前`;", "if (d < 86400000 * 30) return `${Math.floor(d / 86400000)} d ago`;"],
  ["return new Date(ts).toLocaleDateString('zh-CN');", "return new Date(ts).toLocaleDateString('en-US');"],
  ["      text.textContent = '正在引导 Android…';", "      text.textContent = 'Booting Android…';"],
  ["        ? '正在引导 Android…'", "        ? 'Booting Android…'"],
  ["if (!(env.adb && env.adb.ok)) left.push('adb 工具链');", "if (!(env.adb && env.adb.ok)) left.push('adb toolchain');"],
  ["if (!emuDone) left.push('Android 运行时');", "if (!emuDone) left.push('Android runtime');"],
  ["if (!imgDone) left.push('系统镜像');", "if (!imgDone) left.push('system image');"],
  ["    title: allDone ? '一切就绪' : '一键完成',", "    title: allDone ? 'All set' : 'Complete setup',"],
  ["    tag: allDone ? '已自动完成' : '自动',", "    tag: allDone ? 'Done automatically' : 'Auto',"],
  ["? `Android ${s.android || ''} 已就绪 · 应用窗口会按屏幕自动适配`", "? `Android ${s.android || ''} ready · app windows adapt to the screen`"],
  ["        ? '正在引导 Android…'\n        : allDone", "        ? 'Booting Android…'\n        : allDone"],
  ["          ? '组件齐全，双击任意 APK 或桌面图标即会自动开机'", "          ? 'Everything is ready; double-click any APK or desktop icon to boot automatically'"],
  ["          : `还差 ${left.join('、')}；点下面「一键完成」，会在后台一次装好并自动开机`,", "          : `${left.join(', ')} missing; click Complete setup to install everything in the background and boot automatically`,"],
  ['      ? \'<button class="btn ghost sm" data-act="vmStop">停止运行时</button>\'', '      ? \'<button class="btn ghost sm" data-act="vmStop">Stop runtime</button>\''],
  ["  $('btnDeployAll').textContent = busy ? '准备中…' : (allDone ? '已完成 · 点此复查' : '一键完成');", "  $('btnDeployAll').textContent = busy ? 'Preparing…' : (allDone ? 'Done · click to re-check' : 'Complete setup');"],
  ["    ? `上次启动失败：${lf.diagnosis.title}`", "    ? `Last start failed: ${lf.diagnosis.title}`"],
  ["    : (s.diagnosis ? `上次启动自动诊断：${s.diagnosis.title}` : '');", "    : (s.diagnosis ? `Last start auto-diagnosis: ${s.diagnosis.title}` : '');"],
  ["    || s.autoProfile || '全自动：无需选择镜像、无需启用加速、无需调内存';", "    || s.autoProfile || 'Fully automatic: no image choice, acceleration toggle or memory tuning needed';"],
];
for (const [from, to] of appJs) {
  replaceOnce('src/ui/app.js', 'app.js: ' + from.slice(0, 42), from, to);
}

// 8. Built-in driver examples (user-facing data) -----------------------------
for (const f of ['example-amd-igpu-swangle.json', 'example-intel-igpu-software.json', 'example-no-hypervisor-tcg.json']) {
  copyFile(path.join('patch', f), path.join('src', 'drivers', f));
}

// 9. Report ------------------------------------------------------------------
console.log('Target : ' + ROOT);
console.log('App    : ' + APP + ' (' + (PACKAGED ? 'Microsoft Store copy' : 'source checkout') + ')');
if (!PACKAGED) {
  console.log('Skipped: Store-only userData and shared data-dir patches (keeps %APPDATA%\\apkstart)');
}
console.log('Applied: ' + done.length + ' step(s)');
for (const d of done) console.log('  ok  ' + d);
if (problems.length) {
  console.error('\nFAILED steps:');
  for (const p of problems) console.error('  !!  ' + p);
  console.error('\nThis build is not fully patched. Check the ApkStart version (expected 0.6.3-0.6.4).');
  process.exit(1);
}
if (PACKAGED) {
  console.log('\nAll steps applied. Start ' + path.join(ROOT, 'ApkStart.exe'));
} else {
  console.log('\nAll steps applied. Start the app from ' + ROOT + ' with: npm start');
}
