import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const start = html.indexOf('  async function applyNewSyncData(');
const success = html.indexOf("    el('syncProgressBar').style.width = '75%';", start);
assert.ok(start >= 0 && success > start);
const guard = html.slice(start, success) + '\n    return true;\n  }';
const context = vm.createContext({ Date, Number, Array, setSyncStep() {}, el: () => ({ classList: { remove() {} }, disabled: false, innerHTML: '' }) });
vm.runInContext(guard, context);

const started = Date.now() - 10000;
const record = { liveKingdeeExport: true, filename: 'On-Hand Inventory.xlsx', snapshotAt: new Date(started + 5000).toISOString(), exportStartedAt: new Date(started).toISOString(), expectedRows: 2, actualRows: 2, rows: [{}, {}] };
assert.equal(await context.applyNewSyncData(record), true);
assert.equal(await context.applyNewSyncData({ ...record, liveKingdeeExport: false }), false);
assert.equal(await context.applyNewSyncData({ ...record, snapshotAt: new Date(started - 6000).toISOString() }), false);
assert.equal(await context.applyNewSyncData({ ...record, actualRows: 1 }), false);
assert.equal(await context.applyNewSyncData({ ...record, rows: [{}] }), false);
assert.equal(await context.applyNewSyncData({ ...record, exportStartedAt: '' }), false);
console.log('Kingdee freshness checks passed');
