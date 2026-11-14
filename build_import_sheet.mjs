import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('C:/Users/Admin/Downloads/h9-part-readiness-source-20261002/node_modules/xlsx');

global.window = {};

// 1. Load Department Map & Overrides
const mapCode = fs.readFileSync('C:/Users/Admin/Downloads/OnHand-Inventory-Planner/DepartmentMapSeed.js', 'utf8');
eval(mapCode);
const overrides = global.window.DEPARTMENT_OVERRIDES || [];
const overrideMap = new Map();
overrides.forEach(o => overrideMap.set(String(o.materialCode).trim(), o.department));

const deptSeed = global.window.DEPARTMENT_SEED?.rows || [];
const deptSeedMap = new Map();
deptSeed.forEach(d => deptSeedMap.set(String(d.materialCode).trim(), d.department));

// 2. Load latest OnHandSeed (Nov 6, 2026)
const seedCode = fs.readFileSync('C:/Users/Admin/Downloads/OnHand-Inventory-Planner/OnHandSeed.js', 'utf8');
eval(seedCode);
const inv = global.window.ONHAND_SEED?.inventory || [];
const invStamp = global.window.ONHAND_SEED?.snapshotAt || new Date().toISOString();
const invDateFormatted = invStamp.slice(0, 10);
const invFilename = global.window.ONHAND_SEED?.filename || 'On-Hand Inventory-20261106160521208-Somrudee Banthao.xlsx';

// 3. Load latest PartRequisitionsSeed (Nov 7, 2026)
if (fs.existsSync('C:/Users/Admin/Downloads/OnHand-Inventory-Planner/PartRequisitionsSeed.js')) {
  eval(fs.readFileSync('C:/Users/Admin/Downloads/OnHand-Inventory-Planner/PartRequisitionsSeed.js', 'utf8'));
}
const partReqs = global.window.PART_REQUISITIONS_SEED?.items || [];

// 4. Load latest BomSeed
if (fs.existsSync('C:/Users/Admin/Downloads/OnHand-Inventory-Planner/BomSeed.js')) {
  eval(fs.readFileSync('C:/Users/Admin/Downloads/OnHand-Inventory-Planner/BomSeed.js', 'utf8'));
}
const bomRows = global.window.BOM_SEED?.rows || [];
const bomStamp = global.window.BOM_SEED?.snapshotAt || invStamp;

const wb = XLSX.utils.book_new();

// Tab 1: PartRequisitions (Put right at the front or alongside Inventory so it's immediately visible!)
const partReqHeaders = [
  'reqId',
  'requestDate',
  'requestedAt',
  'moNumber',
  'ppbomNumber',
  'directTransferDocs',
  'materialCode',
  'materialName',
  'specification',
  'requestQty',
  'unit',
  'reason',
  'requesterName',
  'shift',
  'requesterNote',
  'status',
  'locationsSummary',
  'locationsJson',
  'issuerName',
  'issuedAt',
  'issuerNote',
  'issuePhotoStatus',
  'updatedAt'
];
const partReqAoA = [partReqHeaders];
for (const r of partReqs) {
  partReqAoA.push([
    r.reqId || '',
    r.requestDate || '',
    r.requestedAt || '',
    r.moNumber || '',
    r.ppbomNumber || '',
    r.directTransferDocs || '',
    r.materialCode || '',
    r.materialName || '',
    r.specification || '',
    Number(r.requestQty) || 0,
    r.unit || 'PCS',
    r.reason || '',
    r.requesterName || '',
    r.shift || 'A',
    r.requesterNote || '',
    r.status || 'pending',
    r.locationsSummary || '',
    JSON.stringify(r.locations || []),
    r.issuerName || '',
    r.issuedAt || '',
    r.issuerNote || '',
    r.issuePhotoDataUrl ? 'VERIFIED_CAMERA_PHOTO' : '',
    r.updatedAt || ''
  ]);
}

// Tab 2: Inventory (Latest Nov 6, 2026)
const invHeaders = [
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
const invAoA = [invHeaders];
for (const r of inv) {
  const code = String(r.materialCode || r.partCode || '').trim();
  const dept = overrideMap.get(code) || deptSeedMap.get(code) || r.department || '';
  invAoA.push([
    code,
    r.materialName || r.partName || '',
    r.warehouse || 'Raw Material Warehouse',
    dept,
    Number(r.onHand !== undefined ? r.onHand : r.onHandQty) || 0,
    Number(r.reserved) || 0,
    Number(r.availableQty) || 0,
    r.unit || 'PCS',
    invFilename,
    invStamp,
    r.specification || '',
    r.storage || '',
    r.lotNumber || '',
    r.owner || '',
    r.ownerType || '',
    r.status || 'Available'
  ]);
}

// Tab 3: Sheet1 (Summary & Quick Status)
const nowIso = new Date().toISOString();
const sheet1AoA = [
  ['On-Hand Inventory Planner - H9 Assembly (Google Sheet Database)', ''],
  ['อัปเดตข้อมูลล่าสุดเมื่อ (Last Updated)', nowIso],
  ['วันที่ข้อมูล On-Hand ล่าสุด (Latest Inventory Snapshot)', invStamp],
  ['ไฟล์ On-Hand ล่าสุดจาก Kingdee', invFilename],
  ['จำนวนรายการ On-Hand ทั้งหมด (แถว)', inv.length],
  ['จำนวนรายการเบิก Part เพิ่มเติม (PartRequisitions)', partReqs.length]
];

// Tab 4: BOM (compact summary or full BOM)
const bomHeaders = ['department', 'modelCode', 'modelName', 'materialCode', 'materialName', 'specification', 'qtyPer', 'unit', 'source', 'importedAt'];
const bomAoA = [bomHeaders];
for (const b of bomRows.slice(0, 15000)) {
  bomAoA.push([
    b.department || 'H9 Assembly Production Line',
    b.modelCode || '',
    b.modelName || '',
    b.materialCode || '',
    b.materialName || '',
    b.specification || '',
    Number(b.qtyPer) || 0,
    b.unit || 'PCS',
    b.source || 'Kingdee BOM Export (Latest)',
    b.importedAt || bomStamp
  ]);
}

// Tab 5: SafetyStock
const safetyAoA = [['materialCode', 'safetyStock', 'minStock', 'maxStock', 'updatedAt', 'updatedBy']];

// Tab 6: Imports (Showing latest Nov 6-7, 2026 dates!)
const importsAoA = [
  ['type', 'filename', 'count', 'department', 'at'],
  ['inventory', invFilename, inv.length, 'ทุกแผนก (Kingdee Real-time)', invStamp],
  ['partRequisitions', 'PartRequisitions Live Sync', partReqs.length, 'H9 Assembly Production Line', nowIso]
];

// Tab 7: Plans
const plansAoA = [['department', 'modelCode', 'quantity']];

// Tab 8: Settings
const settingsAoA = [
  ['key', 'value'],
  ['activeDepts', JSON.stringify(['H9 Assembly Production Line', 'H1 Assembly Production Line', 'Assembly Production Line'])],
  ['autoRefresh08', 'true'],
  ['autoSync10m', 'true'],
  ['lastInventoryAt', invStamp],
  ['lastBomAt', bomStamp],
  ['lastPartRequisitionAt', nowIso],
  ['updatedAt', nowIso]
];

// Tab 9: Department
const deptAoA = [['materialCode', 'materialName', 'Specification', 'Department', 'updatedAt']];
for (const o of overrides) {
  deptAoA.push([o.materialCode || '', o.materialName || '', o.specification || '', o.department || 'H1 Assembly Production Line', invDateFormatted]);
}

// Tab 10: PartStaff (รายชื่อคนเบิก Part / คนจ่าย Part)
const staffRoster = global.window.PART_REQUISITIONS_SEED?.staffRoster || {
  requesters: ['พนักงานเบิก Part (Production)', 'สมฤดี บรรเทา (Somrudee)'],
  issuers: ['เจ้าหน้าที่คลังจ่าย Part (Warehouse)', 'สมฤดี บรรเทา (Somrudee)']
};
const partStaffAoA = [['คนเบิก Part', 'คนจ่าย Part', 'ชื่อ-นามสกุล', 'หน้าที่ (คนเบิก / คนจ่าย)']];
const maxStaffLen = Math.max((staffRoster.requesters || []).length, (staffRoster.issuers || []).length);
for (let i = 0; i < maxStaffLen; i++) {
  const reqName = (staffRoster.requesters || [])[i] || '';
  const whName = (staffRoster.issuers || [])[i] || '';
  partStaffAoA.push([reqName, whName, reqName || whName, reqName ? 'คนเบิก Part' : 'คนจ่าย Part']);
}

XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet1AoA), 'Sheet1');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(invAoA), 'Inventory');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(partReqAoA), 'PartRequisitions');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(partStaffAoA), 'PartStaff');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bomAoA), 'BOM');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(safetyAoA), 'SafetyStock');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(importsAoA), 'Imports');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(plansAoA), 'Plans');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(settingsAoA), 'Settings');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(deptAoA), 'Department');

const outPaths = [
  'C:/Users/Admin/Downloads/OnHand-Inventory-Planner/On-Hand-Inventory-Google-Sheet-Import.xlsx',
  'C:/Users/Admin/Downloads/On-Hand-Inventory-Google-Sheet-Import.xlsx',
  'C:/Users/Admin/Downloads/h9-part-readiness-source-20261002/On-Hand-Inventory-Google-Sheet-Import.xlsx'
];
for (const p of outPaths) {
  try {
    XLSX.writeFile(wb, p);
    console.log('Written updated Google Sheet workbook:', p);
  } catch (e) {
    console.warn('Could not write:', p, e.message);
  }
}
