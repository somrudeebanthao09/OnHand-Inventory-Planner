// เตรียมไฟล์สำหรับ push ขึ้น Apps Script ของ Part API (ใช้ใน .github/workflows/deploy-part-api.yml)
// - เริ่มจากไฟล์ทั้งหมดที่ดึงมาจาก project จริง (remote/) เพื่อไม่ให้ไฟล์อื่นใน project หาย
// - แทนไฟล์ที่เป็น Part API (มี PART_REQ_API_SPREADSHEET_ID) ด้วย PartRequisitionApi.gs ในรีโป
// - ค่าที่ตั้งไว้ใน project จริงแต่ในรีโปเว้นว่าง (Telegram/Discord/Push worker) จะถูกคงไว้
// - ใช้ manifest ของ project จริงเป็นฐาน; ถ้าไม่มี webapp จะตั้งเป็น ANYONE_ANONYMOUS (หน้าเว็บ GitHub Pages เรียกโดยไม่ล็อกอิน Google)
import fs from 'node:fs';
import path from 'node:path';

const [remoteDir = 'remote', buildDir = 'build', srcFile = 'PartRequisitionApi.gs'] = process.argv.slice(2);
const MARKER = 'PART_REQ_API_SPREADSHEET_ID';
const KEEP_IF_REPO_EMPTY = /^const (PART_REQ_PUSH_WORKER_URL|PART_REQ_TELEGRAM_[A-Z_]+|PART_REQ_DISCORD_[A-Z_]+) = '(.*)';\s*$/;

const files = fs.existsSync(remoteDir) ? fs.readdirSync(remoteDir).filter(f => /\.(js|gs|html|json)$/.test(f)) : [];
if (!files.includes('appsscript.json')) {
  console.error(`::error::ไม่พบ appsscript.json ใน ${remoteDir} — clasp pull ไม่สำเร็จ จึงไม่ push เพื่อไม่ให้ไฟล์อื่นใน project ถูกลบ`);
  process.exit(1);
}
fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(buildDir, { recursive: true });
for (const f of files) fs.copyFileSync(path.join(remoteDir, f), path.join(buildDir, f));

const apiFiles = files.filter(f => /\.(js|gs)$/.test(f) && fs.readFileSync(path.join(remoteDir, f), 'utf8').includes(MARKER));
if (apiFiles.length > 1) {
  console.error(`::error::พบไฟล์ Part API มากกว่า 1 ไฟล์ใน project: ${apiFiles.join(', ')} — แก้ใน Apps Script ให้เหลือไฟล์เดียวก่อน`);
  process.exit(1);
}
const target = apiFiles[0] || 'PartRequisitionApi.js';
const remoteSrc = apiFiles[0] ? fs.readFileSync(path.join(remoteDir, apiFiles[0]), 'utf8') : '';
const remoteValues = new Map();
remoteSrc.split('\n').forEach(line => { const m = KEEP_IF_REPO_EMPTY.exec(line); if (m && m[2]) remoteValues.set(m[1], line); });

const kept = [];
const out = fs.readFileSync(srcFile, 'utf8').split('\n').map(line => {
  const m = KEEP_IF_REPO_EMPTY.exec(line);
  if (m && !m[2] && remoteValues.has(m[1])) { kept.push(m[1]); return remoteValues.get(m[1]); }
  return line;
}).join('\n');
fs.writeFileSync(path.join(buildDir, target), out);

const manifest = JSON.parse(fs.readFileSync(path.join(remoteDir, 'appsscript.json'), 'utf8'));
if (!manifest.webapp) manifest.webapp = { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' };
fs.writeFileSync(path.join(buildDir, 'appsscript.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`แทนไฟล์ ${target} ด้วย ${srcFile}${apiFiles[0] ? '' : ' (ไฟล์ใหม่ — ไม่พบไฟล์ Part API เดิม)'}`);
console.log(`ไฟล์อื่นที่คงไว้: ${files.filter(f => f !== target && f !== 'appsscript.json').join(', ') || '—'}`);
console.log(`ค่าที่คงไว้จาก project จริง: ${kept.join(', ') || '—'}`);
console.log(`webapp: ${JSON.stringify(manifest.webapp)}`);
