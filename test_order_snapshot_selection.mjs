import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const start = html.indexOf('  function shouldUseProductionOrdersSeed(');
const end = html.indexOf('  function localDb()', start);
assert.ok(start >= 0 && end > start);
const context = vm.createContext({ Date, Number, Array });
vm.runInContext(html.slice(start, end), context);
const chooseSeed = context.shouldUseProductionOrdersSeed;
const seed = { snapshotAt: '2026-10-27T09:43:00Z', orders: [{ onlyZjdbMode: true }, {}] };
assert.equal(chooseSeed([], '', seed), true);
assert.equal(chooseSeed([{ onlyZjdbMode: true }], '2026-10-29T09:43:00Z', seed), false, 'newer import remains even when row count differs');
assert.equal(chooseSeed([{ onlyZjdbMode: true }], '2026-10-26T09:43:00Z', seed), true, 'newer seed replaces older import');
assert.equal(chooseSeed([{ onlyZjdbMode: true }], '2026-10-27T09:43:00Z', seed), false, 'equal timestamp does not overwrite');
assert.equal(chooseSeed([{ onlyZjdbMode: false }], '2026-10-29T09:43:00Z', seed), false, 'newer data is not overwritten based on schema marker');
assert.equal(chooseSeed([{ onlyZjdbMode: true }], '', { orders: [] }), false);
console.log('Production order snapshot selection checks passed');
