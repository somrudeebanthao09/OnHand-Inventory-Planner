import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('C:/Users/Admin/Downloads/h9-part-readiness-source-20261002/node_modules/xlsx');

// 1. Load department overrides and seed
global.window = {};
const mapCode = fs.readFileSync('C:/Users/Admin/Downloads/OnHand-Inventory-Planner/DepartmentMapSeed.js', 'utf8');
eval(mapCode);

const overrides = global.window.DEPARTMENT_OVERRIDES || [];
const overrideMap = new Map();
overrides.forEach(o => overrideMap.set(String(o.materialCode).trim(), o.department));

const deptSeed = global.window.DEPARTMENT_SEED?.rows || [];
const deptSeedMap = new Map();
deptSeed.forEach(d => deptSeedMap.set(String(d.materialCode).trim(), d.department));

// 2. Load latest OnHandSeed
const seedCode = fs.readFileSync('C:/Users/Admin/Downloads/OnHand-Inventory-Planner/OnHandSeed.js', 'utf8');
eval(seedCode);
const inv = global.window.ONHAND_SEED?.inventory || [];
const stamp = global.window.ONHAND_SEED?.snapshotAt || new Date().toISOString();
const fname = global.window.ONHAND_SEED?.filename || 'On-Hand Inventory-20261014120727602-Somrudee Banthao.xlsx';

console.log('Total inventory items:', inv.length);

// 3. Build rows matching Google Sheet exact columns
// A: materialCode, B: materialName, C: warehouse, D: department, E: onHand, F: reserved, G: availableQty, H: unit, I: source, J: importedAt
// K: specification, L: storage, M: lotNumber, N: owner, O: ownerType, P: status
const headers = [
  'materialCode',
  'materialName',
  'warehouse',
  'department',
  'onHand',
  'reserved',
  'availableQty',
  'unit',
  'source',
  'importedAt',
  'specification',
  'storage',
  'lotNumber',
  'owner',
  'ownerType',
  'status'
];

let h1Count = 0;
const data = [headers];
for (const r of inv) {
  const code = String(r.materialCode || r.partCode || '').trim();
  let dept = '';
  if (overrideMap.has(code)) {
    dept = overrideMap.get(code);
    h1Count++;
  } else if (deptSeedMap.has(code)) {
    dept = deptSeedMap.get(code);
  } else if (r.department) {
    dept = r.department;
  }

  data.push([
    code,
    r.materialName || r.partName || '',
    r.warehouse || 'Raw Material Warehouse',
    dept,
    Number(r.onHand !== undefined ? r.onHand : r.onHandQty) || 0,
    Number(r.reserved) || 0,
    Number(r.availableQty) || 0,
    r.unit || 'PCS',
    fname,
    stamp,
    r.specification || '',
    r.storage || '',
    r.lotNumber || '',
    r.owner || '',
    r.ownerType || '',
    r.status || 'Available'
  ]);
}

console.log('Matched H1 items in inventory:', h1Count);

// Save to On-Hand-Inventory-Google-Sheet-Import.xlsx
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(data);
XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
const targetFile = 'C:/Users/Admin/Downloads/OnHand-Inventory-Planner/On-Hand-Inventory-Google-Sheet-Import.xlsx';
XLSX.writeFile(wb, targetFile);
console.log('Successfully written', targetFile);

// Also create a strictly 10-column version if the user prefers exact 10 columns only
const data10 = data.map(row => row.slice(0, 10));
const wb10 = XLSX.utils.book_new();
const ws10 = XLSX.utils.aoa_to_sheet(data10);
XLSX.utils.book_append_sheet(wb10, ws10, 'Inventory');
const targetFile10 = 'C:/Users/Admin/Downloads/OnHand-Inventory-Planner/On-Hand-Inventory-Google-Sheet-Import-10cols.xlsx';
XLSX.writeFile(wb10, targetFile10);
console.log('Successfully written 10-column version:', targetFile10);
