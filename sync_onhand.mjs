import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('C:/Users/Admin/Downloads/h9-part-readiness-source-20261002/node_modules/xlsx');

const DOWNLOADS = path.resolve('C:/Users/Admin/Downloads');
const PLANNER_DIR = path.resolve('C:/Users/Admin/Downloads/OnHand-Inventory-Planner');
const SEED_FILE = path.join(PLANNER_DIR, 'OnHandSeed.js');
const SHEET_IMPORT_FILE = path.join(PLANNER_DIR, 'On-Hand-Inventory-Google-Sheet-Import.xlsx');

export function processFile(filePath) {
  console.log(`[Sync] Reading file: ${filePath}`);
  const stat = fs.statSync(filePath);
  const stamp = stat.mtime.toISOString();
  const filename = path.basename(filePath);

  const wb = XLSX.readFile(filePath, { cellDates: false, raw: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("ไฟล์ไม่มีชีตข้อมูล");

  const table = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false });
  const headerRowIdx = table.findIndex(r => r.includes('Material') && r.includes('Available Inventory Quantity'));
  if (headerRowIdx < 0) throw new Error("ไม่พบแถวหัวตาราง Material / Available Inventory Quantity");

  const headers = table[headerRowIdx];
  const colCode = headers.indexOf('Material');
  const colName = headers.indexOf('Material Name');
  const colSpec = headers.indexOf('Specification');
  const colWh = headers.indexOf('Warehouse');
  const colBin = headers.indexOf('Storage Bin');
  const colUnit = headers.indexOf('BUoM');
  const colOnHand = headers.indexOf('Inventory Quantity');
  const colRes = headers.indexOf('Inventory Quantity Reserved');
  const colAvail = headers.indexOf('Available Inventory Quantity');
  const colLot = headers.indexOf('Lot Number');
  const colOwner = headers.indexOf('Owner');
  const colOwnerType = headers.indexOf('Owner Type');
  const colStatus = headers.indexOf('Inventory Status');

  const rows = [];
  const sheetRows = [];

  for (let i = headerRowIdx + 1; i < table.length; i++) {
    const r = table[i];
    const code = String(r[colCode] || '').trim();
    if (!code) continue;

    const onHand = Number(r[colOnHand]) || 0;
    const reserved = Number(r[colRes]) || 0;
    const availableQty = Number(r[colAvail]) || 0;
    const item = {
      materialCode: code,
      materialName: String(r[colName] || '').trim(),
      specification: String(r[colSpec] || '').trim(),
      warehouse: String(r[colWh] || '').trim() || 'ไม่ระบุคลัง',
      storage: String(r[colBin] || '').trim(),
      onHand,
      reserved,
      availableQty,
      department: '',
      unit: String(r[colUnit] || '').trim(),
      lotNumber: colLot >= 0 ? String(r[colLot] || '').trim() : '',
      owner: colOwner >= 0 ? String(r[colOwner] || '').trim() : '',
      ownerType: colOwnerType >= 0 ? String(r[colOwnerType] || '').trim() : '',
      status: colStatus >= 0 ? String(r[colStatus] || '').trim() : 'Available',
      source: filename,
      importedAt: stamp
    };
    rows.push(item);
  }

  console.log(`[Sync] Parsed ${rows.length} rows.`);

  // 1. Update OnHandSeed.js
  const seedContent = `window.ONHAND_SEED = ${JSON.stringify({
    snapshotAt: stamp,
    filename: filename,
    sourceFile: filePath.replace(/\\/g, '/'),
    inventory: rows
  })};\n`;
  fs.writeFileSync(SEED_FILE, seedContent, 'utf8');
  console.log(`[Sync] Updated ${SEED_FILE} successfully.`);

  // 2. Update On-Hand-Inventory-Google-Sheet-Import.xlsx
  const importHeader = ['materialCode','materialName','specification','warehouse','storage','onHand','unit','department','reserved','availableQty','lotNumber','owner','ownerType','status','source','importedAt'];
  const importData = [importHeader];
  for (const r of rows) {
    importData.push([
      r.materialCode,
      r.materialName,
      r.specification,
      r.warehouse,
      r.storage,
      r.onHand,
      r.unit,
      r.department,
      r.reserved,
      r.availableQty,
      r.lotNumber,
      r.owner,
      r.ownerType,
      r.status,
      r.source,
      r.importedAt
    ]);
  }
  const newWb = XLSX.utils.book_new();
  const newWs = XLSX.utils.aoa_to_sheet(importData);
  XLSX.utils.book_append_sheet(newWb, newWs, 'Inventory');
  XLSX.writeFile(newWb, SHEET_IMPORT_FILE);
  console.log(`[Sync] Updated Google Sheet import file: ${SHEET_IMPORT_FILE}`);

  return { count: rows.length, filename, stamp };
}

const ORDERS_SEED_FILE = path.join(PLANNER_DIR, 'ProductionOrdersSeed.js');

export function processPMLFile(filePath) {
  console.log(`[Sync] Reading PML file: ${filePath}`);
  const stat = fs.statSync(filePath);
  const stamp = stat.mtime.toISOString();
  const filename = path.basename(filePath);

  const wb = XLSX.readFile(filePath, { cellDates: false, raw: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("ไฟล์ไม่มีชีตข้อมูล");

  const table = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false });
  const headerRowIdx = table.findIndex(r => r.includes('Production Order Number') && r.includes('Unissued Quantity'));
  if (headerRowIdx < 0) throw new Error("ไม่พบแถวหัวตาราง Production Order Number / Unissued Quantity");

  const headers = table[headerRowIdx];
  const colTaskStatus = headers.indexOf('Production Order Task Status');
  const colPickStatus = headers.indexOf('Work Order Pick Status');
  const colDocStatus = headers.indexOf('Document Status');
  const colMo = headers.indexOf('Production Order Number');
  const colProdCode = headers.indexOf('Product Code');
  const colProdName = headers.indexOf('Product Name');
  const colDept = headers.indexOf('Production Department');
  const colMat = headers.indexOf('Material Code');
  const colMatName = headers.indexOf('Material Name');
  const colSpec = headers.indexOf('Specification');
  const colUnit = headers.indexOf('Component UoM');
  const colDemand = headers.indexOf('Demand Quantity');
  const colIssued = headers.indexOf('Issued Quantity');
  const colUnissued = headers.indexOf('Unissued Quantity');
  const colReqTime = headers.indexOf('Required Time');

  const rows = [];
  for (let i = headerRowIdx + 1; i < table.length; i++) {
    const r = table[i];
    const mo = String(r[colMo] || '').trim();
    const mat = String(r[colMat] || '').trim();
    if (!mo || !mat) continue;

    rows.push({
      moNumber: mo,
      docStatus: String(r[colDocStatus] || '').trim(),
      productCode: String(r[colProdCode] || '').trim(),
      productName: String(r[colProdName] || '').trim(),
      department: String(r[colDept] || '').trim(),
      taskStatus: String(r[colTaskStatus] || '').trim(),
      pickStatus: String(r[colPickStatus] || '').trim(),
      materialCode: mat,
      materialName: String(r[colMatName] || '').trim(),
      specification: String(r[colSpec] || '').trim(),
      unit: String(r[colUnit] || '').trim(),
      demandQty: Number(r[colDemand]) || 0,
      issuedQty: Number(r[colIssued]) || 0,
      unissuedQty: Number(r[colUnissued]) || 0,
      requiredTime: String(r[colReqTime] || '').trim()
    });
  }

  const seed = {
    snapshotAt: stamp,
    filename: filename,
    source: 'Kingdee Production Material List',
    count: rows.length,
    orders: rows
  };

  fs.writeFileSync(ORDERS_SEED_FILE, 'window.PRODUCTION_ORDERS_SEED = ' + JSON.stringify(seed) + ';\n', 'utf8');
  console.log(`[Sync] Updated ${ORDERS_SEED_FILE} successfully (${rows.length} active orders).`);
  return seed;
}

const BOM_SEED_FILE = path.join(PLANNER_DIR, 'BomSeed.js');

export function processBOMFile(filePath) {
  console.log(`[Sync] Reading BOM file: ${filePath}`);
  const stat = fs.statSync(filePath);
  const stamp = stat.mtime.toISOString();
  const filename = path.basename(filePath);

  const wb = XLSX.readFile(filePath, { cellDates: false, raw: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("ไฟล์ไม่มีชีตข้อมูล");

  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false });
  const headers = data[0] || [];
  const prodCodeIdx = headers.findIndex(h => /Product Code|产品编码/i.test(h));
  const prodNameIdx = headers.findIndex(h => /Product Name|产品名称/i.test(h));
  const childCodeIdx = headers.findIndex(h => /Child Item Code|子项物料编码/i.test(h));
  const childNameIdx = headers.findIndex(h => /Child Item Name|子项物料名称/i.test(h));
  const numIdx = headers.findIndex(h => /Quantity: Numerator|分子/i.test(h));
  const denIdx = headers.findIndex(h => /Quantity: Denominator|分母/i.test(h));
  const unitIdx = headers.findIndex(h => /Child Item Unit|单位/i.test(h));

  let orderModelMap = new Map();
  try {
    const ordersSeed = JSON.parse(fs.readFileSync(ORDERS_SEED_FILE, 'utf8').replace('window.PRODUCTION_ORDERS_SEED = ', '').replace(/;?\s*$/, '')).orders;
    ordersSeed.forEach(o => {
      if (o.productCode && o.department) {
        if (!orderModelMap.has(o.productCode)) orderModelMap.set(o.productCode, new Set());
        orderModelMap.get(o.productCode).add(o.department);
      }
    });
  } catch (_) {}

  let matDeptMap = new Map();
  try {
    const deptSeed = JSON.parse(fs.readFileSync(path.join(PLANNER_DIR, 'DepartmentMapSeed.js'), 'utf8').replace('window.DEPARTMENT_SEED = ', '').replace(/;?\s*$/, '')).rows;
    deptSeed.forEach(r => {
      if (r.materialCode && r.department) {
        if (!matDeptMap.has(r.materialCode)) matDeptMap.set(r.materialCode, r.department);
      }
    });
  } catch (_) {}

  function inferDept(code, name) {
    const pfx = code.slice(0, 4);
    const n = (name || '').toLowerCase();
    
    // 1. Prioritize explicit department from Kingdee Production Material List (PML)
    if (orderModelMap.has(code)) {
      const d = [...orderModelMap.get(code)][0];
      if (d) return d;
    }

    // 2. Finished Goods (6001 = Electrical/Assembly, 6002 = Auto, 6003 = Die Cast)
    if (pfx === '6001') {
      if (n.includes('h9') || n.includes('classic') || n.includes('load center') || n.includes('ez9') || n.includes('easypact') || n.includes('consumer unit') || n.includes('visismart') || n.includes('resi9') || n.includes('box assy') || n.includes('cu ') || n.includes('split') || n.includes('greco coil') || n.includes('terminal lug')) {
        return 'H9 Assembly Production Line';
      }
      if (n.includes('packing') || n.includes('packaging')) return 'Electrical Packaging Production Line';
      return 'Assembly Production Line';
    }
    if (pfx === '6002') return 'Automotive Packaging Production Line';
    if (pfx === '6003') return 'Aluminum Die Casting - Packaging Production Line';

    // 3. Sub-assemblies (5001 = Electrical sub, 5002 = Auto sub, 5003 = Die Cast sub, 5004/5 = Pkg)
    if (pfx === '5001') {
      if (n.includes('powder') || n.includes('coating') || n.includes('screen')) return 'Powder Coating Production Line';
      if (n.includes('weld') || n.includes('rivet') || n.includes('tap')) return 'Welding、Riveting、Tapping Production Line';
      return 'Electrical Stamping Production Line';
    }
    if (pfx === '5002') {
      if (n.includes('weld') || n.includes('rivet') || n.includes('tap')) return 'Welding、Riveting、Tapping Production Line';
      return 'Automotive Stamping Production Line';
    }
    if (pfx === '5003') {
      if (n.includes('cnc')) return 'Aluminum Die Casting - CNC Production line';
      if (n.includes('die cast') || n.includes('casting')) return 'Aluminum Die Casting - Die Casting Production Line';
      return 'Aluminum Die Casting - Grinding and Shot Blasting Production Line';
    }
    if (pfx === '5004') return 'Electrical Packaging Production Line';
    if (pfx === '5005') return 'Automotive Packaging Production Line';

    // 4. Raw/machined parts (1001-1005)
    if (code.startsWith('100')) return 'Electrical Stamping Production Line';

    return 'Assembly Production Line';
  }

  const bMap = new Map();
  const modelsMap = new Map();

  if (fs.existsSync(BOM_SEED_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(BOM_SEED_FILE, 'utf8').replace('window.BOM_SEED = ', '').replace(/;?\s*$/, ''));
      if (Array.isArray(existing.rows)) {
        existing.rows.forEach(r => {
          r.department = inferDept(r.modelCode, r.modelName);
          bMap.set(r.modelCode + '|||' + r.materialCode, r);
        });
      }
      if (Array.isArray(existing.models)) {
        existing.models.forEach(m => {
          m.department = inferDept(m.code, m.name);
          modelsMap.set(m.code, m);
        });
      }
    } catch (_) {}
  }

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r || !r[prodCodeIdx] || !r[childCodeIdx]) continue;
    const modelCode = String(r[prodCodeIdx]).trim();
    const modelName = String(r[prodNameIdx] || '').trim();
    const materialCode = String(r[childCodeIdx]).trim();
    const materialName = String(r[childNameIdx] || '').trim();
    const num = Number(r[numIdx]) || 1;
    const den = Number(r[denIdx]) || 1;
    const qtyPer = Math.round((num / den) * 1000000) / 1000000;
    const unit = String(r[unitIdx] || '').trim();
    const dept = inferDept(modelCode, modelName);

    bMap.set(modelCode + '|||' + materialCode, {
      department: dept,
      modelCode,
      modelName,
      materialCode,
      materialName,
      qtyPer,
      unit
    });

    modelsMap.set(modelCode, { code: modelCode, name: modelName, department: dept });
  }

  const rows = [...bMap.values()];
  const modelsList = [...modelsMap.values()].sort((a,b) => (a.name||a.code).localeCompare(b.name||b.code, undefined, {numeric: true, sensitivity: 'base'}));

  const seed = {
    snapshotAt: stamp,
    filename: filename,
    source: 'Kingdee BOM Maintenance List',
    count: rows.length,
    modelCount: modelsList.length,
    models: modelsList,
    rows: rows
  };

  fs.writeFileSync(BOM_SEED_FILE, 'window.BOM_SEED = ' + JSON.stringify(seed) + ';\n', 'utf8');
  console.log(`[Sync] Updated ${BOM_SEED_FILE} successfully (${rows.length} BOM rows, ${modelsList.length} models).`);
  return seed;
}

// Check latest file or watch mode
const args = process.argv.slice(2);
if (args[0] === '--watch') {
  console.log(`[Watcher] Monitoring ${DOWNLOADS} for On-Hand Inventory, PML, and BOM files...`);
  let lastProcessedOnHand = '';
  let lastProcessedPml = '';
  let lastProcessedBom = '';
  
  const check = () => {
    try {
      // 1. Check On-Hand
      const onhandFiles = fs.readdirSync(DOWNLOADS)
        .filter(f => /^on-hand inventory.*\.xlsx$/i.test(f))
        .map(f => ({ name: f, path: path.join(DOWNLOADS, f), mtime: fs.statSync(path.join(DOWNLOADS, f)).mtime }))
        .sort((a, b) => b.mtime - a.mtime);

      if (onhandFiles.length > 0 && onhandFiles[0].name !== lastProcessedOnHand) {
        const target = onhandFiles[0];
        const size1 = fs.statSync(target.path).size;
        setTimeout(() => {
          try {
            const size2 = fs.statSync(target.path).size;
            if (size1 === size2 && size1 > 10000 && target.name !== lastProcessedOnHand) {
              lastProcessedOnHand = target.name;
              console.log(`[Watcher] New On-Hand file detected: ${target.name}`);
              processFile(target.path);
            }
          } catch (_) {}
        }, 1500);
      }

      // 2. Check PML
      const pmlFiles = fs.readdirSync(DOWNLOADS)
        .filter(f => /production material list.*\.xlsx$/i.test(f))
        .map(f => ({ name: f, path: path.join(DOWNLOADS, f), mtime: fs.statSync(path.join(DOWNLOADS, f)).mtime }))
        .sort((a, b) => b.mtime - a.mtime);

      if (pmlFiles.length > 0 && pmlFiles[0].name !== lastProcessedPml) {
        const target = pmlFiles[0];
        const size1 = fs.statSync(target.path).size;
        setTimeout(() => {
          try {
            const size2 = fs.statSync(target.path).size;
            if (size1 === size2 && size1 > 10000 && target.name !== lastProcessedPml) {
              lastProcessedPml = target.name;
              console.log(`[Watcher] New PML file detected: ${target.name}`);
              processPMLFile(target.path);
            }
          } catch (_) {}
        }, 1500);
      }

      // 3. Check BOM
      const bomFiles = fs.readdirSync(DOWNLOADS)
        .filter(f => /bom maintenance list.*\.xlsx$/i.test(f) || /kingdee.*bom.*\.xlsx$/i.test(f))
        .map(f => ({ name: f, path: path.join(DOWNLOADS, f), mtime: fs.statSync(path.join(DOWNLOADS, f)).mtime }))
        .sort((a, b) => b.mtime - a.mtime);

      if (bomFiles.length > 0 && bomFiles[0].name !== lastProcessedBom) {
        const target = bomFiles[0];
        const size1 = fs.statSync(target.path).size;
        setTimeout(() => {
          try {
            const size2 = fs.statSync(target.path).size;
            if (size1 === size2 && size1 > 10000 && target.name !== lastProcessedBom) {
              lastProcessedBom = target.name;
              console.log(`[Watcher] New BOM file detected: ${target.name}`);
              processBOMFile(target.path);
            }
          } catch (_) {}
        }, 1500);
      }
    } catch (e) {
      console.error('[Watcher error]:', e.message);
    }
  };

  setInterval(check, 3000);
  check();
} else {
  // Run on newest existing files
  const onhandFiles = fs.readdirSync(DOWNLOADS)
    .filter(f => /^on-hand inventory.*\.xlsx$/i.test(f))
    .map(f => ({ name: f, path: path.join(DOWNLOADS, f), mtime: fs.statSync(path.join(DOWNLOADS, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);

  if (onhandFiles.length > 0) {
    processFile(onhandFiles[0].path);
  }

  const pmlFiles = fs.readdirSync(DOWNLOADS)
    .filter(f => /production material list.*\.xlsx$/i.test(f))
    .map(f => ({ name: f, path: path.join(DOWNLOADS, f), mtime: fs.statSync(path.join(DOWNLOADS, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);

  if (pmlFiles.length > 0) {
    processPMLFile(pmlFiles[0].path);
  }

  const bomFiles = fs.readdirSync(DOWNLOADS)
    .filter(f => /bom maintenance list.*\.xlsx$/i.test(f) || /kingdee.*bom.*\.xlsx$/i.test(f))
    .map(f => ({ name: f, path: path.join(DOWNLOADS, f), mtime: fs.statSync(path.join(DOWNLOADS, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);

  if (bomFiles.length > 0) {
    processBOMFile(bomFiles[0].path);
  }
}

