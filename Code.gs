/**
 * Google Sheets storage for Material Planner.
 * This app reads/writes only the bound planner spreadsheet. It does not call Kingdee.
 */
const DB_TABS = {
  Inventory: ['materialCode','materialName','specification','warehouse','storage','onHand','unit','department','reserved','availableQty','lotNumber','owner','ownerType','status','source','importedAt'],
  DepartmentMap: ['materialCode','materialName','department','modelCodes','period','source','importedAt'],
  BOM: ['department','modelCode','modelName','materialCode','materialName','qtyPer','unit','source','importedAt'],
  ProductionOrders: ['moNumber','docStatus','productCode','productName','department','taskStatus','pickStatus','materialCode','materialName','specification','unit','demandQty','issuedQty','unissuedQty','requiredTime'],
  SafetyStock: ['materialCode','value','updatedAt'],
  Imports: ['type','filename','count','department','at'],
  Plans: ['modelCode','quantity'],
  Settings: ['key','value'],
  AccessRequests: ['email','displayName','status','requestedAt','reviewedAt','reviewedBy']
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Material Planner')
    .addItem('เตรียมชีตระบบ', 'setup')
    .addItem('เปิดหน้า Material Planner', 'showAppUrl')
    .addToUi();
}

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('กรุณาเปิด Apps Script จาก Google Sheet ของระบบนี้ แล้วลองใหม่');
  PropertiesService.getScriptProperties().setProperty('PLANNER_SPREADSHEET_ID', ss.getId());
  Object.keys(DB_TABS).forEach(name => {
    if (name === 'DepartmentMap' && ss.getSheetByName('Department')) return;
    ensureTab_(ss, name, DB_TABS[name]);
  });
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PLANNER_ADMIN_EMAIL')) {
    const adminEmail = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
    if (!adminEmail) throw new Error('ตรวจสอบอีเมล Admin ไม่ได้ กรุณาใช้บัญชี Google Workspace ขององค์กร');
    props.setProperty('PLANNER_ADMIN_EMAIL', adminEmail);
  }
  const settings = ss.getSheetByName('Settings');
  if (settings.getLastRow() < 2) {
    settings.getRange(2, 1, 3, 2).setValues([
      ['activeDepts', JSON.stringify(['H9 Assembly Production Line', 'H1 Assembly Production Line', 'Assembly Production Line'])],
      ['autoRefresh08', 'false'],
      ['lastInventoryAt', '']
    ]);
  }
  SpreadsheetApp.getUi().alert('เตรียมแท็บ Inventory, DepartmentMap, BOM, SafetyStock, Imports, Plans และ Settings แล้ว');
}

function doGet() {
  const template = HtmlService.createTemplateFromFile('Index');
  return template.evaluate().setTitle('Material Planner · H9 Assembly');
}

function showAppUrl() {
  const url = ScriptApp.getService().getUrl();
  SpreadsheetApp.getUi().alert(url ? 'URL หน้าเว็บที่เผยแพร่:\n' + url : 'ยังไม่ได้เผยแพร่ Web app กรุณาเลือก Deploy → New deployment → Web app');
}

function getAccessState() {
  const email = currentUserEmail_();
  if (!email) return {ok: false, reason: 'EMAIL_UNAVAILABLE', message: 'ตรวจสอบอีเมล Google ไม่ได้ กรุณาเปิดด้วยบัญชี Google Workspace ขององค์กร'};
  const adminEmail = String(PropertiesService.getScriptProperties().getProperty('PLANNER_ADMIN_EMAIL') || '').trim().toLowerCase();
  if (email === adminEmail) return {ok: true, email, status: 'approved', isAdmin: true};
  const requests = readObjects_(getAccessRequestsSheet_());
  const request = requests.find(row => String(row.email || '').trim().toLowerCase() === email);
  return {ok: true, email, status: request ? String(request.status || 'pending') : 'not_registered', isAdmin: false};
}

function submitAccessRequest(displayName) {
  const email = currentUserEmail_();
  if (!email) throw new Error('ตรวจสอบอีเมล Google ไม่ได้ กรุณาใช้บัญชี Google Workspace ขององค์กร');
  const adminEmail = String(PropertiesService.getScriptProperties().getProperty('PLANNER_ADMIN_EMAIL') || '').trim().toLowerCase();
  if (email === adminEmail) return getAccessState();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getAccessRequestsSheet_();
    const requests = readObjects_(sheet);
    const existing = requests.find(row => String(row.email || '').trim().toLowerCase() === email);
    if (existing && existing.status === 'approved') return getAccessState();
    const now = new Date().toISOString();
    if (existing) {
      existing.displayName = safeCell_(displayName);
      existing.status = 'pending';
      existing.requestedAt = now;
      existing.reviewedAt = '';
      existing.reviewedBy = '';
    } else {
      requests.push({email, displayName: safeCell_(displayName), status: 'pending', requestedAt: now, reviewedAt: '', reviewedBy: ''});
    }
    writeObjects_(sheet, DB_TABS.AccessRequests, requests);
    return getAccessState();
  } finally {
    lock.releaseLock();
  }
}

function listAccessRequests() {
  assertAdmin_();
  return readObjects_(getAccessRequestsSheet_()).sort((a, b) => String(b.requestedAt || '').localeCompare(String(a.requestedAt || '')));
}

function reviewAccessRequest(email, decision) {
  assertAdmin_();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !['approved', 'rejected'].includes(decision)) throw new Error('ข้อมูลคำขอไม่ถูกต้อง');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getAccessRequestsSheet_();
    const requests = readObjects_(sheet);
    const request = requests.find(row => String(row.email || '').trim().toLowerCase() === normalizedEmail);
    if (!request) throw new Error('ไม่พบคำขอนี้');
    request.status = decision;
    request.reviewedAt = new Date().toISOString();
    request.reviewedBy = currentUserEmail_();
    writeObjects_(sheet, DB_TABS.AccessRequests, requests);
    SpreadsheetApp.flush();
    return {ok: true, email: normalizedEmail, status: decision};
  } finally {
    lock.releaseLock();
  }
}

function currentUserEmail_() {
  return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
}

function assertApproved_() {
  const state = getAccessState();
  if (!state.ok) throw new Error(state.message || 'ไม่สามารถยืนยันบัญชี Google ได้');
  if (state.status !== 'approved') throw new Error('บัญชีนี้ยังไม่ได้รับอนุมัติให้ใช้เว็บ');
  return state;
}

function assertAdmin_() {
  const state = assertApproved_();
  if (!state.isAdmin) throw new Error('เฉพาะ Admin เท่านั้นที่อนุมัติผู้ใช้ได้');
  return state;
}

function getAccessRequestsSheet_() {
  const ss = getPlannerSpreadsheet_();
  return ensureTab_(ss, 'AccessRequests', DB_TABS.AccessRequests);
}

function safeCell_(value) {
  const text = String(value || '').trim().slice(0, 120);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function getDepartmentSheet_(ss) {
  return ss.getSheetByName('Department') || ss.getSheetByName('DepartmentMap');
}

function getAppData() {
  assertApproved_();
  const ss = getPlannerSpreadsheet_();
  Object.keys(DB_TABS).forEach(name => {
    if (name === 'DepartmentMap' && ss.getSheetByName('Department')) return;
    ensureTab_(ss, name, DB_TABS[name]);
  });
  const inventory = readObjects_(ss.getSheetByName('Inventory'));
  const deptSheet = getDepartmentSheet_(ss);
  const departmentMap = deptSheet ? readObjects_(deptSheet) : [];
  departmentMap.forEach(row => {
    if (row.department && (/^H1(\s+Assembly(\s+Production\s+Line)?)?$/i.test(String(row.department).trim()) || String(row.department).trim() === 'H1')) {
      row.department = 'H1 Assembly Production Line';
    }
  });
  const bom = readObjects_(ss.getSheetByName('BOM'));
  const imports = readObjects_(ss.getSheetByName('Imports'));
  const plans = readObjects_(ss.getSheetByName('Plans'));
  const safetyStock = {};
  readObjects_(ss.getSheetByName('SafetyStock')).forEach(row => {
    if (row.materialCode) safetyStock[String(row.materialCode)] = {value: Number(row.value) || 0, updatedAt: row.updatedAt || ''};
  });
  const settings = {};
  readObjects_(ss.getSheetByName('Settings')).forEach(row => {
    if (!row.key) return;
    try { settings[row.key] = JSON.parse(row.value); } catch (_) { settings[row.key] = row.value; }
  });
  return {inventory, departmentMap, bom, safetyStock, imports, plans, settings};
}

function saveInventorySnapshot(rows, sourceInfo) {
  assertApproved_();
  if (!Array.isArray(rows)) throw new Error('ไม่พบรายการ On-Hand สำหรับบันทึก');
  if (rows.length > 50000) throw new Error('ข้อมูลเกิน 50,000 แถว กรุณาแบ่งไฟล์นำเข้า');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = getPlannerSpreadsheet_();
    Object.keys(DB_TABS).forEach(name => {
      if (name === 'DepartmentMap' && ss.getSheetByName('Department')) return;
      ensureTab_(ss, name, DB_TABS[name]);
    });
    const stamp = sourceInfo && sourceInfo.at ? sourceInfo.at : new Date().toISOString();
    const filename = sourceInfo && sourceInfo.filename ? sourceInfo.filename : 'Kingdee On-Hand';
    writeObjects_(ss.getSheetByName('Inventory'), DB_TABS.Inventory, rows);

    const importRows = readObjects_(ss.getSheetByName('Imports'));
    importRows.push({type: 'inventory', filename, count: rows.length, department: '', at: stamp});
    writeObjects_(ss.getSheetByName('Imports'), DB_TABS.Imports, importRows);

    const settingsRows = readObjects_(ss.getSheetByName('Settings'));
    const lastInventory = settingsRows.find(row => row.key === 'lastInventoryAt');
    if (lastInventory) lastInventory.value = JSON.stringify(stamp);
    else settingsRows.push({key: 'lastInventoryAt', value: JSON.stringify(stamp)});
    writeObjects_(ss.getSheetByName('Settings'), DB_TABS.Settings, settingsRows);
    SpreadsheetApp.flush();
    return {ok: true, count: rows.length, savedAt: stamp};
  } finally {
    lock.releaseLock();
  }
}

function saveAppData(data) {
  assertApproved_();
  if (!data || typeof data !== 'object') throw new Error('ไม่พบข้อมูลสำหรับบันทึก');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = getPlannerSpreadsheet_();
    Object.keys(DB_TABS).forEach(name => {
      if (name === 'DepartmentMap' && ss.getSheetByName('Department')) return;
      ensureTab_(ss, name, DB_TABS[name]);
    });
    writeObjects_(ss.getSheetByName('Inventory'), DB_TABS.Inventory, data.inventory || []);
    const deptSheet = getDepartmentSheet_(ss) || ss.getSheetByName('DepartmentMap');
    if (deptSheet) {
      const headers = deptSheet.getName() === 'Department'
        ? ['materialCode','materialName','specification','department']
        : DB_TABS.DepartmentMap;
      writeObjects_(deptSheet, headers, data.departmentMap || []);
    }
    writeObjects_(ss.getSheetByName('BOM'), DB_TABS.BOM, data.bom || []);
    const safetyRows = Object.keys(data.safetyStock || {}).map(materialCode => {
      const item = data.safetyStock[materialCode];
      return {materialCode, value: typeof item === 'object' ? item.value : item, updatedAt: typeof item === 'object' ? item.updatedAt : ''};
    });
    writeObjects_(ss.getSheetByName('SafetyStock'), DB_TABS.SafetyStock, safetyRows);
    writeObjects_(ss.getSheetByName('Imports'), DB_TABS.Imports, data.imports || []);
    writeObjects_(ss.getSheetByName('Plans'), DB_TABS.Plans, data.plans || []);
    const settingRows = Object.keys(data.settings || {}).map(key => ({key, value: JSON.stringify(data.settings[key])}));
    writeObjects_(ss.getSheetByName('Settings'), DB_TABS.Settings, settingRows);
    SpreadsheetApp.flush();
    return {ok: true, savedAt: new Date().toISOString()};
  } finally {
    lock.releaseLock();
  }
}

function getPlannerSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('PLANNER_SPREADSHEET_ID');
  if (!id) throw new Error('ยังไม่ได้เตรียมฐานข้อมูล กรุณาเปิด Apps Script จาก Google Sheet แล้วเรียก setup() หนึ่งครั้ง');
  return SpreadsheetApp.openById(id);
}

function ensureTab_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e6f5f3');
  } else {
    const width = Math.max(sheet.getLastColumn(), 1);
    const current = sheet.getRange(1, 1, 1, width).getValues()[0].map(value => String(value || '').trim());
    const missing = headers.filter(header => !current.includes(header));
    if (missing.length) {
      sheet.getRange(1, width + 1, 1, missing.length).setValues([missing]);
      sheet.getRange(1, 1, 1, width + missing.length).setFontWeight('bold').setBackground('#e6f5f3');
    }
  }
  return sheet;
}

function readObjects_(sheet) {
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const rawHeaders = values[0].map(h => String(h || '').trim());
  return values.slice(1).filter(row => row.some(cell => cell !== '' && cell !== null)).map(row => {
    const out = {};
    rawHeaders.forEach((header, i) => {
      const val = row[i] instanceof Date ? row[i].toISOString() : row[i];
      out[header] = val;
      const lower = header.toLowerCase();
      if (lower === 'materialcode' || lower === 'part' || lower === 'partno') out.materialCode = val;
      if (lower === 'materialname' || lower === 'partname') out.materialName = val;
      if (lower === 'specification' || lower === 'spec') out.specification = val;
      if (lower === 'department' || lower === 'dept') out.department = val;
    });
    return out;
  });
}

function writeObjects_(sheet, headers, rows) {
  const oldRows = sheet.getLastRow();
  if (oldRows > 1) sheet.getRange(2, 1, oldRows - 1, sheet.getMaxColumns()).clearContent();
  if (!rows.length) return;
  if (rows.length > 50000) throw new Error('ข้อมูลเกิน 50,000 แถว กรุณาแบ่งไฟล์นำเข้า');
  const columnHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0].map(value => String(value || '').trim());
  const values = rows.map(row => columnHeaders.map(header => {
    const value = header && row[header] !== undefined && row[header] !== null ? row[header] : '';
    if (typeof value === 'string' && /^[=+\-@]/.test(value)) return "'" + value;
    return value;
  }));
  const neededCols = columnHeaders.length;
  if (sheet.getMaxColumns() < neededCols) sheet.insertColumnsAfter(sheet.getMaxColumns(), neededCols - sheet.getMaxColumns());
  sheet.getRange(2, 1, values.length, neededCols).setValues(values);
}

function requestKingdeeSync() {
  assertApproved_();
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = getPlannerSpreadsheet_();
    ensureTab_(ss, 'Settings', DB_TABS.Settings);
    const settingsSheet = ss.getSheetByName('Settings');
    const settingsRows = readObjects_(settingsSheet);
    
    let existingReq = null;
    const reqRow = settingsRows.find(r => r.key === 'kingdeeSyncRequest');
    if (reqRow && reqRow.value) {
      try {
        existingReq = typeof reqRow.value === 'string' ? JSON.parse(reqRow.value) : reqRow.value;
      } catch (_) {}
    }

    const now = Date.now();
    if (existingReq && (existingReq.status === 'pending' || existingReq.status === 'processing')) {
      const age = now - new Date(existingReq.requestedAt || 0).getTime();
      if (age < 90000) {
        return { ok: true, isExisting: true, request: existingReq };
      }
    }

    const newReq = {
      id: 'req_' + now,
      status: 'pending',
      requestedBy: currentUserEmail_() || 'user',
      requestedAt: new Date(now).toISOString(),
      startedAt: null,
      completedAt: null,
      message: 'ส่งคำขอแล้ว กำลังรอเครื่อง Admin เริ่มงาน...',
      rowCount: 0
    };

    if (reqRow) {
      reqRow.value = JSON.stringify(newReq);
    } else {
      settingsRows.push({ key: 'kingdeeSyncRequest', value: JSON.stringify(newReq) });
    }
    writeObjects_(settingsSheet, DB_TABS.Settings, settingsRows);
    SpreadsheetApp.flush();
    return { ok: true, isExisting: false, request: newReq };
  } finally {
    lock.releaseLock();
  }
}

function getKingdeeSyncStatus() {
  assertApproved_();
  const ss = getPlannerSpreadsheet_();
  const settingsSheet = ss.getSheetByName('Settings');
  const settingsRows = readObjects_(settingsSheet);
  const reqRow = settingsRows.find(r => r.key === 'kingdeeSyncRequest');
  let request = null;
  if (reqRow && reqRow.value) {
    try {
      request = typeof reqRow.value === 'string' ? JSON.parse(reqRow.value) : reqRow.value;
    } catch (_) {}
  }
  const lastInventory = settingsRows.find(r => r.key === 'lastInventoryAt');
  let lastInventoryAt = '';
  if (lastInventory && lastInventory.value) {
    try { lastInventoryAt = JSON.parse(lastInventory.value); } catch (_) { lastInventoryAt = lastInventory.value; }
  }
  return { ok: true, request, lastInventoryAt };
}

function updateKingdeeSyncStatus(requestId, status, message, rowCount) {
  assertApproved_();
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = getPlannerSpreadsheet_();
    const settingsSheet = ss.getSheetByName('Settings');
    const settingsRows = readObjects_(settingsSheet);
    const reqRow = settingsRows.find(r => r.key === 'kingdeeSyncRequest');
    if (!reqRow) return { ok: false, message: 'ไม่พบคิวคำขอ' };
    
    let currentReq = null;
    try { currentReq = typeof reqRow.value === 'string' ? JSON.parse(reqRow.value) : reqRow.value; } catch (_) {}
    if (!currentReq || currentReq.id !== requestId) {
      return { ok: false, message: 'Request ID ไม่ตรงกัน' };
    }

    currentReq.status = status;
    currentReq.message = message || currentReq.message;
    if (status === 'processing') {
      currentReq.startedAt = new Date().toISOString();
    } else if (status === 'completed' || status === 'failed') {
      currentReq.completedAt = new Date().toISOString();
      if (typeof rowCount === 'number') currentReq.rowCount = rowCount;
    }

    reqRow.value = JSON.stringify(currentReq);
    writeObjects_(settingsSheet, DB_TABS.Settings, settingsRows);
    SpreadsheetApp.flush();
    return { ok: true, request: currentReq };
  } finally {
    lock.releaseLock();
  }
}

