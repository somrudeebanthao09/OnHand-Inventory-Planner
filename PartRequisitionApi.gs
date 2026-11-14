// Standalone Apps Script endpoint for the Part requisition module only.
// Deploy as a web app executing as the owner; requests are authenticated with app-user credentials.
const PART_REQ_API_SPREADSHEET_ID = '1at35N5AItBVGiwRmgF74JAB2u6w4ZQ5MZJX1ExgNJHg';
const PART_REQ_API_SHEET_NAME = 'PartRequisitions';
const PART_REQ_API_HEADERS = [
  'reqId','requestDate','moNumber','ppbomNumber','directTransferDocs',
  'materialCode','materialName','specification','requestQty','unit','reason',
  'requesterName','requesterUsername','shift','requesterNote','requestedAt','status',
  'locationsSummary','locationsJson','issuerName','issuerUsername','issuerNote','issuedAt',
  'hasPhoto','photoTakenAt','updatedAt','photoUrl'
];
const PART_REQ_API_ITERATIONS = 30000;
const PART_REQ_API_SESSION_TTL_SECONDS = 21600;
const PART_REQ_API_ALLOWED_ORIGIN = '*';

function doGet() {
  return ContentService.createTextOutput('Part requisition API is ready.')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  const params = e && e.parameter ? e.parameter : {};
  const requestId = String(params.requestId || '');
  let result;
  try {
    if (params.action === 'challenge') {
      result = partReqApiChallenge_(params.username);
    } else if (params.action === 'login') {
      result = partReqApiLogin_(params.username, params.password, params.verifier);
    } else if (params.action === 'member_login') {
      result = partReqApiMemberLogin_(params.username, params.password);
    } else if (params.action === 'member_register') {
      const regUser = JSON.parse(String(params.user || '{}'));
      result = partReqApiMemberRegister_(regUser);
    } else if (params.action === 'members_list') {
      result = { ok: true, users: partReqApiGetMembers_() };
    } else {
      const session = partReqApiGetSession_(params.token);
      if (!session) throw new Error('SESSION_EXPIRED');
      if (params.action === 'list') {
        result = { ok: true, items: partReqApiList_(), staffRoster: partReqApiGetStaffRoster_() };
      } else if (params.action === 'save') {
        const record = JSON.parse(String(params.record || '{}'));
        result = partReqApiSave_(session, record);
      } else if (params.action === 'push_subscribe') {
        const subRecord = JSON.parse(String(params.subscription || '{}'));
        result = partReqApiPushSubscribe_(session, subRecord);
      } else if (params.action === 'push_unsubscribe') {
        result = partReqApiPushUnsubscribe_(String(params.endpoint || ''));
      } else if (params.action === 'push_list') {
        result = { ok: true, subscriptions: partReqApiPushList_() };
      } else if (params.action === 'save_staff') {
        const roster = JSON.parse(String(params.roster || '{}'));
        result = { ok: true, staffRoster: partReqApiSaveStaffRoster_(roster) };
      } else if (params.action === 'save_order_pdf') {
        const doc = JSON.parse(String(params.doc || '{}'));
        result = partReqApiSaveOrderPdfToDrive_(doc);
      } else if (params.action === 'list_order_pdfs') {
        result = { ok: true, items: partReqApiListOrderPdfs_() };
      } else if (params.action === 'members_save') {
        const users = JSON.parse(String(params.users || '[]'));
        result = { ok: true, users: partReqApiSaveMembers_(users) };
      } else if (params.action === 'member_reset_password') {
        result = partReqApiMemberResetPassword_(params.username, params.newPassword);
      } else {
        throw new Error('UNKNOWN_ACTION');
      }
    }
  } catch (err) {
    result = { ok: false, error: String(err && err.message || err) };
  }
  result.requestId = requestId;
  return partReqApiMessage_(result);
}

function setupPartReqApiSheet() {
  const sheet = partReqApiGetSheet_();
  return { ok: true, sheetName: sheet.getName(), columns: PART_REQ_API_HEADERS.length };
}

// Run once after setting PART_REQ_API_PASSWORDS in Script Properties as {"req":"…","wh":"…"}.
// This replaces the temporary passwords with salted verifiers and removes the plaintext property.
function setupPartReqApiCredentials() {
  const properties = PropertiesService.getScriptProperties();
  const raw = properties.getProperty('PART_REQ_API_PASSWORDS');
  if (!raw) throw new Error('Set PART_REQ_API_PASSWORDS in Script Properties first.');
  const passwords = JSON.parse(raw);
  const users = {};
  ['req', 'wh'].forEach(username => {
    const password = String(passwords[username] || '');
    if (!password) throw new Error('Both req and wh passwords are required.');
    const salt = Utilities.base64Encode(Utilities.newBlob(Utilities.getUuid() + Utilities.getUuid()).getBytes());
    users[username] = { salt, hash: partReqApiPasswordHash_(password, salt) };
  });
  properties.setProperty('PART_REQ_API_USERS', JSON.stringify(users));
  properties.deleteProperty('PART_REQ_API_PASSWORDS');
  return { ok: true, users: ['req', 'wh'], plaintextRemoved: true };
}

function partReqApiChallenge_(usernameValue) {
  const username = String(usernameValue || '').trim().toLowerCase();
  if (!['req', 'wh'].includes(username)) throw new Error('INVALID_CREDENTIALS');
  let users = {};
  try {
    users = JSON.parse(PropertiesService.getScriptProperties().getProperty('PART_REQ_API_USERS') || '{}');
  } catch (_) {}
  const verifier = users[username];
  if (!verifier?.salt || !verifier?.hash) throw new Error('INVALID_CREDENTIALS');
  return {
    ok: true,
    username,
    role: username === 'req' ? 'requester' : 'warehouse',
    salt: verifier.salt,
    iterations: PART_REQ_API_ITERATIONS,
    hash: 'SHA-256'
  };
}

function partReqApiLogin_(usernameValue, passwordValue, submittedVerifierValue) {
  const username = String(usernameValue || '').trim().toLowerCase();
  const password = String(passwordValue || '');
  const submittedVerifier = String(submittedVerifierValue || '').trim();
  if (!['req', 'wh'].includes(username) || (!password && !submittedVerifier)) throw new Error('INVALID_CREDENTIALS');

  const cache = CacheService.getScriptCache();
  const failKey = `part_req_login_fail_${username}`;
  const failedAttempts = Number(cache.get(failKey) || 0);
  if (failedAttempts >= 10) throw new Error('LOGIN_TEMPORARILY_LOCKED');

  let users = {};
  try {
    users = JSON.parse(PropertiesService.getScriptProperties().getProperty('PART_REQ_API_USERS') || '{}');
  } catch (_) {}
  const verifier = users[username];
  const valid = verifier && (submittedVerifier
    ? partReqApiConstantTimeEqual_(submittedVerifier, String(verifier.hash || ''))
    : partReqApiPasswordHash_(password, verifier.salt) === verifier.hash);
  if (!valid) {
    cache.put(failKey, String(failedAttempts + 1), 900);
    throw new Error('INVALID_CREDENTIALS');
  }

  cache.remove(failKey);
  const token = `${Utilities.getUuid()}${Utilities.getUuid().replace(/-/g, '')}`;
  const role = username === 'req' ? 'requester' : 'warehouse';
  cache.put(`part_req_session_${token}`, JSON.stringify({ username, role }), PART_REQ_API_SESSION_TTL_SECONDS);
  return { ok: true, token, username, role, expiresIn: PART_REQ_API_SESSION_TTL_SECONDS };
}

function partReqApiConstantTimeEqual_(leftValue, rightValue) {
  const left = String(leftValue || '');
  const right = String(rightValue || '');
  if (!left || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function partReqApiPasswordHash_(password, saltBase64) {
  const key = Utilities.newBlob(String(password)).getBytes();
  const salt = Utilities.base64Decode(String(saltBase64 || ''));
  let block = salt.concat([0, 0, 0, 1]);
  let u = Utilities.computeHmacSha256Signature(block, key);
  const derived = u.slice();
  for (let round = 1; round < PART_REQ_API_ITERATIONS; round++) {
    u = Utilities.computeHmacSha256Signature(u, key);
    for (let i = 0; i < derived.length; i++) derived[i] = derived[i] ^ u[i];
  }
  return Utilities.base64Encode(derived);
}

function partReqApiGetSession_(tokenValue) {
  const token = String(tokenValue || '');
  if (!/^[a-f0-9-]{50,80}$/i.test(token)) return null;
  const raw = CacheService.getScriptCache().get(`part_req_session_${token}`);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    return ['requester', 'warehouse'].includes(session.role) ? session : null;
  } catch (_) {
    return null;
  }
}

function partReqApiList_() {
  const sheet = partReqApiGetSheet_();
  const rows = partReqApiReadRows_(sheet);
  return rows.map(row => {
    const { _sheetRow, ...publicRow } = row;
    let locations = [];
    try { locations = JSON.parse(String(row.locationsJson || '[]')); } catch (_) {}
    const isDeleted = String(row.issuerNote || '').includes('[DELETED_BY_ADMIN]');
    return {
      ...publicRow,
      deleted: isDeleted,
      deletedAt: isDeleted ? String(row.updatedAt || row.issuedAt || '') : '',
      requestQty: Number(row.requestQty) || 0,
      locations: Array.isArray(locations) ? locations : [],
      issuePhotoDataUrl: '',
      hasPhoto: !isDeleted && ['yes', 'true', '1'].includes(String(row.hasPhoto || '').trim().toLowerCase()),
      photoAttachmentUrl: isDeleted ? '' : String(row.photoUrl || '')
    };
  });
}

function partReqApiSave_(session, record) {
  if (!record || typeof record !== 'object') throw new Error('INVALID_RECORD');
  const reqId = String(record.reqId || '').trim();
  if (!reqId || reqId.length > 100) throw new Error('INVALID_REQUEST_ID');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = partReqApiGetSheet_();
    const rows = partReqApiReadRows_(sheet);
    const existing = rows.find(row => String(row.reqId || '').trim() === reqId) || null;
    const suppliedAt = Date.parse(String(record.updatedAt || record.issuedAt || record.requestedAt || '')) || Date.now();
    const storedAt = Date.parse(String(existing?.updatedAt || existing?.issuedAt || existing?.requestedAt || '')) || 0;
    let merged;

    if (Boolean(record.deleted) || String(record.issuerNote || '').includes('[DELETED_BY_ADMIN]')) {
      if (existing && existing._sheetRow >= 2) {
        sheet.deleteRow(existing._sheetRow);
        SpreadsheetApp.flush();
      }
      return { ok: true, reqId, status: 'deleted', deleted: true, savedAt: new Date().toISOString() };
    }

    if (session.role === 'requester') {
      if (record.status === 'issued' || (existing && existing.status === 'issued')) throw new Error('REQUEST_ALREADY_ISSUED');
      if (existing?.requesterUsername && String(existing.requesterUsername).toLowerCase() !== session.username) {
        throw new Error('REQUEST_OWNER_MISMATCH');
      }
      if (existing && storedAt > suppliedAt) {
        return { ok: true, reqId, status: existing.status || 'pending', savedAt: existing.updatedAt || '', ignoredStaleUpdate: true };
      }
      merged = {
        ...(existing || {}),
        ...record,
        reqId,
        requesterUsername: session.username,
        status: 'pending',
        issuerName: existing?.issuerName || '',
        issuerUsername: existing?.issuerUsername || '',
        issuerNote: existing?.issuerNote || '',
        issuedAt: existing?.issuedAt || '',
        locations: existing?.locations || [],
        updatedAt: String(record.updatedAt || record.requestedAt || new Date().toISOString())
      };
    } else {
      if (record.status !== 'issued') throw new Error('WAREHOUSE_MUST_ISSUE');
      if (existing?.status === 'issued' && storedAt >= suppliedAt) {
        return { ok: true, reqId, status: 'issued', savedAt: existing.updatedAt || '', ignoredStaleUpdate: true };
      } else {
        const issuedAt = String(record.issuedAt || record.updatedAt || new Date().toISOString());
        const drivePhotoUrl = savePartPhotoToDrive_({ ...(existing || {}), ...record, reqId, issuedAt });
        const finalPhotoUrl = drivePhotoUrl || String(record.photoAttachmentUrl || record.photoUrl || existing?.photoUrl || '');
        merged = existing ? {
          ...existing,
          reqId,
          requestDate: String(record.requestDate || existing.requestDate || ''),
          requestedAt: String(record.requestedAt || existing.requestedAt || ''),
          status: 'issued',
          locations: Array.isArray(record.locations) ? record.locations : [],
          locationsSummary: String(record.locationsSummary || ''),
          issuerName: String(record.issuerName || session.username),
          issuerUsername: session.username,
          issuerNote: String(record.issuerNote || ''),
          issuedAt,
          hasPhoto: Boolean(record.hasPhoto || record.issuePhotoDataUrl || finalPhotoUrl),
          photoTakenAt: String(record.photoTakenAt || issuedAt),
          photoAttachmentUrl: finalPhotoUrl,
          photoUrl: finalPhotoUrl,
          updatedAt: String(record.updatedAt || issuedAt)
        } : {
          ...record,
          reqId,
          requesterUsername: String(record.requesterUsername || ''),
          requesterName: String(record.requesterName || ''),
          status: 'issued',
          issuerUsername: session.username,
          issuedAt,
          hasPhoto: Boolean(record.hasPhoto || record.issuePhotoDataUrl || finalPhotoUrl),
          photoAttachmentUrl: finalPhotoUrl,
          photoUrl: finalPhotoUrl,
          updatedAt: String(record.updatedAt || issuedAt)
        };
      }
    }

    const row = partReqApiWriteRecord_(sheet, merged, existing);
    return { ok: true, reqId, status: row.status, photoUrl: row.photoUrl || '', savedAt: new Date().toISOString() };
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateDriveSubFolder_(parentFolder, name) {
  const it = parentFolder.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parentFolder.createFolder(name);
}

// บันทึกรูปถ่ายยืนยันการจ่ายขึ้น Google Drive แบ่งโฟลเดอร์: วันที่ (YYYY-MM-DD) -> กะ (กะ A/B) -> <รหัสPart>_<reqId>.jpg
function savePartPhotoToDrive_(record) {
  try {
    const dataUrl = String(record.issuePhotoDataUrl || '');
    const m = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i.exec(dataUrl);
    if (!m) return '';
    const ext = m[1].toLowerCase() === 'png' ? 'png' : (m[1].toLowerCase() === 'webp' ? 'webp' : 'jpg');
    const mime = ext === 'png' ? 'image/png' : (ext === 'webp' ? 'image/webp' : 'image/jpeg');

    // หาวันที่ (YYYY-MM-DD) จาก issuedAt หรือ requestDate
    let dateFolderName = '';
    const dtStr = String(record.issuedAt || record.photoTakenAt || record.requestDate || '').replace(/[\u200B-\u200D\uFEFF']/g, '').trim();
    const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(dtStr);
    if (dmy) {
      let yyyy = Number(dmy[3]);
      if (yyyy > 2400) yyyy -= 543;
      dateFolderName = `${yyyy}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
    } else {
      const th = new Date(Date.now() + 7 * 3600 * 1000);
      dateFolderName = th.toISOString().slice(0, 10);
    }

    const shiftRaw = String(record.shift || 'A').trim().toUpperCase();
    const shiftFolderName = `กะ ${shiftRaw === 'B' ? 'B' : 'A'}`;
    const matCode = String(record.materialCode || 'PART').trim().replace(/[^A-Za-z0-9._-]/g, '_');
    const reqId = String(record.reqId || 'REQ').trim().replace(/[^A-Za-z0-9._-]/g, '_');
    const fileName = `${matCode}_${reqId}.${ext}`;

    // วางโฟลเดอร์หลัก Part_Requisitions_Photos ไว้ข้าง Google Sheet (หรือ My Drive)
    let baseParent = DriveApp.getRootFolder();
    try {
      const ssFile = DriveApp.getFileById(PART_REQ_API_SPREADSHEET_ID);
      const parents = ssFile.getParents();
      if (parents.hasNext()) baseParent = parents.next();
    } catch (_) {}

    const rootFolder = getOrCreateDriveSubFolder_(baseParent, 'Part_Requisitions_Photos');
    const dateFolder = getOrCreateDriveSubFolder_(rootFolder, dateFolderName);
    const shiftFolder = getOrCreateDriveSubFolder_(dateFolder, shiftFolderName);

    // ลบไฟล์เดิมถ้ามี reqId ซ้ำ
    const existingFiles = shiftFolder.getFilesByName(fileName);
    while (existingFiles.hasNext()) {
      existingFiles.next().setTrashed(true);
    }

    const bytes = Utilities.base64Decode(m[2]);
    const blob = Utilities.newBlob(bytes, mime, fileName);
    const file = shiftFolder.createFile(blob);
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (_) {}

    return `https://drive.google.com/thumbnail?id=${file.getId()}&sz=w1200`;
  } catch (err) {
    return '';
  }
}

function formatPartReqDateTime_(val, fallbackVal) {
  let raw = String(val || '').replace(/[\u200B-\u200D\uFEFF']/g, '').trim();
  const fb = String(fallbackVal || '').replace(/[\u200B-\u200D\uFEFF']/g, '').trim();
  const isDateOnlyOrMidnight = !raw || /^\d{4}-\d{2}-\d{2}$/.test(raw) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw) || /00:00:00/.test(raw);
  if (isDateOnlyOrMidnight && fb && !/00:00:00/.test(fb)) raw = fb;
  if (!raw) return '';
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw);
  if (dmy) {
    let yyyy = Number(dmy[3]);
    if (yyyy > 2400) yyyy -= 543;
    const pad2 = n => String(n).padStart(2, '0');
    return `${pad2(dmy[1])}/${pad2(dmy[2])}/${yyyy}\u200B ${pad2(dmy[4] || 0)}:${pad2(dmy[5] || 0)}:${pad2(dmy[6] || 0)}`;
  }
  const cleanStr = raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const ms = Date.parse(cleanStr);
  if (!Number.isFinite(ms)) return raw;
  const th = new Date(ms + 7 * 3600 * 1000);
  const pad2 = n => String(n).padStart(2, '0');
  return `${pad2(th.getUTCDate())}/${pad2(th.getUTCMonth() + 1)}/${th.getUTCFullYear()}\u200B ${pad2(th.getUTCHours())}:${pad2(th.getUTCMinutes())}:${pad2(th.getUTCSeconds())}`;
}

function partReqApiToRow_(record) {
  return {
    reqId: String(record.reqId || ''),
    requestDate: formatPartReqDateTime_(record.requestDate, record.requestedAt),
    moNumber: String(record.moNumber || ''),
    ppbomNumber: String(record.ppbomNumber || ''),
    directTransferDocs: String(record.directTransferDocs || ''),
    materialCode: String(record.materialCode || ''),
    materialName: String(record.materialName || ''),
    specification: String(record.specification || ''),
    requestQty: Number(record.requestQty) || 0,
    unit: String(record.unit || 'PCS'),
    reason: String(record.reason || ''),
    requesterName: String(record.requesterName || ''),
    requesterUsername: String(record.requesterUsername || ''),
    shift: String(record.shift || 'A'),
    requesterNote: String(record.requesterNote || ''),
    requestedAt: formatPartReqDateTime_(record.requestedAt, record.requestDate),
    status: record.status === 'issued' ? 'issued' : 'pending',
    locationsSummary: String(record.locationsSummary || ''),
    locationsJson: JSON.stringify(Array.isArray(record.locations) ? record.locations : []),
    issuerName: String(record.issuerName || ''),
    issuerUsername: String(record.issuerUsername || ''),
    issuerNote: String(record.issuerNote || ''),
    issuedAt: record.issuedAt ? formatPartReqDateTime_(record.issuedAt) : '',
    hasPhoto: Boolean(record.hasPhoto || record.issuePhotoDataUrl || record.photoUrl),
    photoTakenAt: (record.photoTakenAt || record.issuedAt) ? formatPartReqDateTime_(record.photoTakenAt || record.issuedAt) : '',
    updatedAt: formatPartReqDateTime_(record.updatedAt || record.issuedAt || record.requestedAt || new Date().toISOString()),
    photoUrl: String(record.photoAttachmentUrl || record.photoUrl || '')
  };
}

function partReqApiGetStaffRoster_() {
  try {
    const ss = SpreadsheetApp.openById(PART_REQ_API_SPREADSHEET_ID);
    const sheet = ss.getSheetByName('PartStaff') || ss.getSheetByName('คนเบิกจ่าย') || ss.getSheetByName('Staff');
    if (!sheet) {
      const created = ss.insertSheet('PartStaff');
      created.getRange(1, 1, 1, 4).setValues([['คนเบิก Part', 'คนจ่าย Part', 'ชื่อ-นามสกุล', 'หน้าที่ (คนเบิก / คนจ่าย)']]);
      created.setFrozenRows(1);
      return { sheetName: 'PartStaff', requesters: [], issuers: [] };
    }
    const values = sheet.getDataRange().getValues();
    const requesters = [];
    const issuers = [];
    if (values.length >= 2) {
      const headers = values[0].map(h => String(h || '').trim().toLowerCase());
      const reqCol = headers.findIndex(h => h.includes('คนเบิก') || h.includes('ผู้เบิก') || h === 'requester');
      const whCol = headers.findIndex(h => h.includes('คนจ่าย') || h.includes('ผู้จ่าย') || h === 'warehouse' || h === 'issuer');
      const nameCol = headers.findIndex(h => h.includes('ชื่อ') || h === 'name');
      const roleCol = headers.findIndex(h => h.includes('หน้าที่') || h.includes('ตำแหน่ง') || h === 'role');
      for (let r = 1; r < values.length; r++) {
        const row = values[r];
        if (reqCol >= 0 && String(row[reqCol] || '').trim()) requesters.push(String(row[reqCol]).trim());
        if (whCol >= 0 && String(row[whCol] || '').trim()) issuers.push(String(row[whCol]).trim());
        if (nameCol >= 0 && roleCol >= 0) {
          const n = String(row[nameCol] || '').trim();
          const rl = String(row[roleCol] || '').trim().toLowerCase();
          if (n) {
            if (rl.includes('เบิก') || rl.includes('req')) requesters.push(n);
            if (rl.includes('จ่าย') || rl.includes('wh') || rl.includes('คลัง') || rl.includes('issu')) issuers.push(n);
          }
        }
      }
    }
    return { sheetName: sheet.getName(), requesters, issuers };
  } catch (_) {
    return { sheetName: 'PartStaff', requesters: [], issuers: [] };
  }
}

function partReqApiSaveStaffRoster_(roster) {
  const ss = SpreadsheetApp.openById(PART_REQ_API_SPREADSHEET_ID);
  let sheet = ss.getSheetByName('PartStaff') || ss.getSheetByName('คนเบิกจ่าย') || ss.getSheetByName('Staff');
  if (!sheet) {
    sheet = ss.insertSheet('PartStaff');
  }
  const reqList = Array.isArray(roster?.requesters) ? roster.requesters.map(v => String(v || '').trim()).filter(Boolean) : [];
  const issList = Array.isArray(roster?.issuers) ? roster.issuers.map(v => String(v || '').trim()).filter(Boolean) : [];
  const maxRows = Math.max(reqList.length, issList.length);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, 2).setValues([['คนเบิก Part', 'คนจ่าย Part']]);
  sheet.setFrozenRows(1);
  if (maxRows > 0) {
    const rows = [];
    for (let i = 0; i < maxRows; i++) {
      rows.push([reqList[i] || '', issList[i] || '']);
    }
    sheet.getRange(2, 1, maxRows, 2).setValues(rows);
  }
  SpreadsheetApp.flush();
  return { sheetName: sheet.getName(), requesters: reqList, issuers: issList };
}

function setupPartStaffSheet() {
  return partReqApiGetStaffRoster_();
}

const MEMBERS_SHEET_NAME = 'Members';
const MEMBERS_HEADERS = ['id', 'username', 'name', 'department', 'role', 'password', 'status', 'approvedAt', 'createdAt'];

function partReqApiGetMembersSheet_() {
  const ss = SpreadsheetApp.openById(PART_REQ_API_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(MEMBERS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(MEMBERS_SHEET_NAME);
  }
  const width = Math.max(sheet.getLastColumn(), MEMBERS_HEADERS.length);
  const firstRow = sheet.getLastRow() >= 1 ? sheet.getRange(1, 1, 1, width).getValues()[0] : [];
  if (!firstRow.some(v => String(v || '').trim())) {
    sheet.getRange(1, 1, 1, MEMBERS_HEADERS.length).setValues([MEMBERS_HEADERS]);
    sheet.setFrozenRows(1);
    const nowIso = new Date().toISOString();
    const defaults = [
      ['usr-admin', 'admin', 'ผู้ดูแลระบบ (Admin)', 'ส่วนกลาง / Management', 'admin', 'admin1234', 'approved', nowIso, nowIso],
      ['usr-user', 'user', 'ผู้ใช้งานทั่วไป (User)', 'H9 Assembly Production Line', 'admin', 'user1234', 'approved', nowIso, nowIso],
      ['usr-req', 'req', 'พนักงานเบิก Part (Production)', 'H9 Assembly Production Line', 'requester', '1234', 'approved', nowIso, nowIso],
      ['usr-wh', 'wh', 'เจ้าหน้าที่คลังจ่าย Part (Warehouse)', 'Warehouse / Logistics', 'warehouse', '1234', 'approved', nowIso, nowIso]
    ];
    sheet.getRange(2, 1, defaults.length, MEMBERS_HEADERS.length).setValues(defaults);
    SpreadsheetApp.flush();
  }
  return sheet;
}

function partReqApiGetMembers_(includeSecrets) {
  const sheet = partReqApiGetMembersSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const rows = sheet.getRange(2, 1, lastRow - 1, MEMBERS_HEADERS.length).getValues();
  return rows.map(r => ({
    id: String(r[0] || '').trim(),
    username: String(r[1] || '').trim(),
    name: String(r[2] || '').trim(),
    department: String(r[3] || '').trim(),
    role: String(r[4] || 'user').trim().toLowerCase(),
    password: includeSecrets ? String(r[5] || '').trim() : '••••••••',
    status: String(r[6] || 'approved').trim().toLowerCase(),
    approvedAt: String(r[7] || '').trim(),
    createdAt: String(r[8] || '').trim()
  })).filter(u => u.username);
}

function partReqApiMemberLogin_(usernameRaw, passwordRaw) {
  const uname = String(usernameRaw || '').trim().toLowerCase();
  const pwd = String(passwordRaw || '').trim();
  if (!uname || !pwd) return { ok: false, error: 'INVALID_CREDENTIALS' };
  const all = partReqApiGetMembers_(true);
  const found = all.find(u => u.username.toLowerCase() === uname);
  if (!found || found.password !== pwd) {
    return { ok: false, error: 'INVALID_CREDENTIALS' };
  }
  let token = '';
  if (found.status === 'approved') {
    token = `${Utilities.getUuid()}${Utilities.getUuid().replace(/-/g, '')}`;
    const apiRole = found.role === 'requester' ? 'requester' : 'warehouse';
    CacheService.getScriptCache().put(
      `part_req_session_${token}`,
      JSON.stringify({ username: found.username, role: apiRole }),
      PART_REQ_API_SESSION_TTL_SECONDS
    );
  }
  return {
    ok: true,
    token,
    expiresIn: PART_REQ_API_SESSION_TTL_SECONDS,
    user: {
      id: found.id,
      username: found.username,
      name: found.name,
      department: found.department,
      role: found.role,
      status: found.status,
      approvedAt: found.approvedAt,
      createdAt: found.createdAt
    }
  };
}

function partReqApiMemberRegister_(regUser) {
  const uname = String(regUser?.username || '').trim().toLowerCase();
  const pwd = String(regUser?.password || '').trim();
  if (!uname || !pwd || pwd.length < 4) return { ok: false, error: 'INVALID_INPUT' };
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const existing = partReqApiGetMembers_(true);
    if (existing.some(u => u.username.toLowerCase() === uname)) {
      return { ok: false, error: 'USERNAME_EXISTS' };
    }
    const sheet = partReqApiGetMembersSheet_();
    const nowIso = new Date().toISOString();
    const row = [
      String(regUser.id || ('u_' + Date.now())),
      uname,
      String(regUser.name || uname).trim(),
      String(regUser.department || 'ทั่วไป').trim(),
      ['requester', 'warehouse', 'user'].includes(String(regUser.role || '').toLowerCase()) ? String(regUser.role).toLowerCase() : 'requester',
      pwd,
      'pending',
      '',
      String(regUser.createdAt || nowIso)
    ];
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    return { ok: true, username: uname, status: 'pending' };
  } finally {
    lock.releaseLock();
  }
}

function partReqApiMemberResetPassword_(usernameRaw, newPassRaw) {
  const uname = String(usernameRaw || '').trim().toLowerCase();
  const newPass = String(newPassRaw || '').trim();
  if (!uname || newPass.length < 4) return { ok: false, error: 'INVALID_PASSWORD' };
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = partReqApiGetMembersSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      const rows = sheet.getRange(2, 1, lastRow - 1, MEMBERS_HEADERS.length).getValues();
      for (let i = 0; i < rows.length; i++) {
        if (String(rows[i][1] || '').trim().toLowerCase() === uname) {
          sheet.getRange(i + 2, 6).setValue(newPass);
          SpreadsheetApp.flush();
          return { ok: true, username: uname };
        }
      }
    }
    return { ok: false, error: 'USER_NOT_FOUND' };
  } finally {
    lock.releaseLock();
  }
}

function partReqApiSaveMembers_(users) {
  const list = Array.isArray(users) ? users.filter(u => u && u.username) : [];
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const existingSecrets = new Map();
    for (const ex of partReqApiGetMembers_(true)) {
      existingSecrets.set(ex.username.toLowerCase(), ex.password);
    }
    const sheet = partReqApiGetMembersSheet_();
    sheet.clearContents();
    sheet.getRange(1, 1, 1, MEMBERS_HEADERS.length).setValues([MEMBERS_HEADERS]);
    sheet.setFrozenRows(1);
    if (list.length) {
      const rows = list.map(u => {
        const uname = String(u.username || '').trim();
        const incomingPwd = String(u.password || '').trim();
        const keptPwd = (incomingPwd && incomingPwd !== '••••••••') ? incomingPwd : (existingSecrets.get(uname.toLowerCase()) || '1234');
        return [
          String(u.id || ('usr-' + uname)),
          uname,
          String(u.name || uname).trim(),
          String(u.department || '').trim(),
          String(u.role || 'user').trim().toLowerCase(),
          keptPwd,
          String(u.status || 'approved').trim().toLowerCase(),
          String(u.approvedAt || '').trim(),
          String(u.createdAt || '').trim()
        ];
      });
      sheet.getRange(2, 1, rows.length, MEMBERS_HEADERS.length).setValues(rows);
    }
    SpreadsheetApp.flush();
    return partReqApiGetMembers_(false);
  } finally {
    lock.releaseLock();
  }
}

function setupAllPlannerSheets() {
  const reqSheet = partReqApiGetSheet_();
  const staff = partReqApiGetStaffRoster_();
  const members = partReqApiGetMembers_();
  const pushSheet = partReqApiGetPushSheet_();
  const pdfSheet = partReqApiGetOrderPdfSheet_();
  return {
    ok: true,
    sheets: [reqSheet.getName(), staff.sheetName || 'PartStaff', MEMBERS_SHEET_NAME, pushSheet.getName(), pdfSheet.getName()],
    membersCount: members.length
  };
}

const ORDER_PDF_LINKS_SHEET_NAME = 'OrderPdfLinks';
const ORDER_PDF_LINKS_HEADERS = ['moNumber', 'docType', 'docNumber', 'fileName', 'fileId', 'fileUrl', 'previewUrl', 'folderUrl', 'updatedAt'];

function partReqApiGetOrderPdfSheet_() {
  const ss = SpreadsheetApp.openById(PART_REQ_API_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(ORDER_PDF_LINKS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(ORDER_PDF_LINKS_SHEET_NAME);
  }
  const width = Math.max(sheet.getLastColumn(), ORDER_PDF_LINKS_HEADERS.length);
  const firstRow = sheet.getLastRow() >= 1 ? sheet.getRange(1, 1, 1, width).getValues()[0] : [];
  if (!firstRow.some(v => String(v || '').trim())) {
    sheet.getRange(1, 1, 1, ORDER_PDF_LINKS_HEADERS.length).setValues([ORDER_PDF_LINKS_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function partReqApiListOrderPdfs_() {
  const sheet = partReqApiGetOrderPdfSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const rows = sheet.getRange(2, 1, lastRow - 1, ORDER_PDF_LINKS_HEADERS.length).getValues();
  return rows.map(r => ({
    moNumber: String(r[0] || '').trim(),
    docType: String(r[1] || 'order').trim().toLowerCase(),
    docNumber: String(r[2] || '').trim(),
    fileName: String(r[3] || '').trim(),
    fileId: String(r[4] || '').trim(),
    fileUrl: String(r[5] || '').trim(),
    previewUrl: String(r[6] || '').trim(),
    folderUrl: String(r[7] || '').trim(),
    updatedAt: String(r[8] || '').trim()
  })).filter(x => x.moNumber && x.fileId);
}

function partReqApiSaveOrderPdfToDrive_(doc) {
  const moNumber = String(doc?.moNumber || '').trim().replace(/[\\/:*?"<>|]/g, '_') || 'UNKNOWN_MO';
  const docType = String(doc?.docType || 'order').trim().toLowerCase() === 'transfer' ? 'transfer' : 'order';
  const docNumber = String(doc?.docNumber || moNumber).trim();
  const rawFileName = String(doc?.fileName || `${docNumber}.pdf`).trim().replace(/[\\/:*?"<>|]/g, '_');
  const fileName = /\.pdf$/i.test(rawFileName) ? rawFileName : `${rawFileName}.pdf`;
  const pdfBase64 = String(doc?.pdfBase64 || '').replace(/^data:application\/pdf;base64,/i, '').trim();
  const htmlContent = String(doc?.html || '').trim();
  if (!pdfBase64 && !htmlContent) throw new Error('EMPTY_PDF_CONTENT');

  const rootFolder = getOrCreateDriveSubFolder_(DriveApp.getRootFolder(), 'Production_Orders_PDF');
  const moFolder = getOrCreateDriveSubFolder_(rootFolder, moNumber);

  // แทนที่ไฟล์ชื่อเดียวกันในโฟลเดอร์ MO เดิมเพื่อไม่ให้ซ้ำ
  const existingFiles = moFolder.getFilesByName(fileName);
  while (existingFiles.hasNext()) {
    try { existingFiles.next().setTrashed(true); } catch (_) {}
  }

  let pdfBlob;
  if (pdfBase64) {
    const bytes = Utilities.base64Decode(pdfBase64);
    pdfBlob = Utilities.newBlob(bytes, 'application/pdf', fileName);
  } else {
    const htmlBlob = Utilities.newBlob(htmlContent, 'text/html; charset=utf-8', fileName.replace(/\.pdf$/i, '.html'));
    pdfBlob = htmlBlob.getAs('application/pdf').setName(fileName);
  }
  const file = moFolder.createFile(pdfBlob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (_) {}

  const fileId = file.getId();
  const fileUrl = `https://drive.google.com/file/d/${fileId}/view`;
  const previewUrl = `https://drive.google.com/file/d/${fileId}/preview`;
  const folderUrl = moFolder.getUrl();
  const nowStr = formatPartReqDateTime_(new Date().toISOString(), '', true);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = partReqApiGetOrderPdfSheet_();
    const lastRow = sheet.getLastRow();
    let targetRow = lastRow + 1;
    if (lastRow >= 2) {
      const existing = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
      for (let i = 0; i < existing.length; i++) {
        if (String(existing[i][0] || '').trim() === moNumber &&
            String(existing[i][1] || '').trim().toLowerCase() === docType &&
            String(existing[i][2] || '').trim() === docNumber) {
          targetRow = i + 2;
          break;
        }
      }
    }
    sheet.getRange(targetRow, 1, 1, ORDER_PDF_LINKS_HEADERS.length).setValues([[
      moNumber, docType, docNumber, fileName, fileId, fileUrl, previewUrl, folderUrl, nowStr
    ]]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  return {
    ok: true,
    moNumber,
    docType,
    docNumber,
    fileName,
    fileId,
    fileUrl,
    previewUrl,
    folderUrl
  };
}

function partReqApiGetSheet_() {
  const ss = SpreadsheetApp.openById(PART_REQ_API_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(PART_REQ_API_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(PART_REQ_API_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, PART_REQ_API_HEADERS.length).setValues([PART_REQ_API_HEADERS]);
    sheet.setFrozenRows(1);
  } else {
    const existingHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), PART_REQ_API_HEADERS.length)).getValues()[0];
    const headerSet = new Set(existingHeaders.map(value => String(value || '').trim()).filter(Boolean));
    const missing = PART_REQ_API_HEADERS.filter(header => !headerSet.has(header));
    if (missing.length) {
      const startColumn = Math.max(sheet.getLastColumn(), 1) + 1;
      sheet.getRange(1, startColumn, 1, missing.length).setValues([missing]);
    }
  }
  return sheet;
}

function partReqApiReadRows_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(value => String(value || '').trim());
  return values.slice(1).map((row, index) => ({ row, sheetRow: index + 2 }))
    .filter(entry => entry.row.some(value => value !== '' && value !== null)).map(({ row, sheetRow }) => {
    const item = {};
    headers.forEach((header, index) => { if (header) item[header] = row[index]; });
    item._sheetRow = sheetRow;
    return item;
  }).filter(item => item.reqId);
}

function partReqApiWriteRecord_(sheet, record, existing) {
  const width = Math.max(sheet.getLastColumn(), PART_REQ_API_HEADERS.length);
  const currentHeaders = sheet.getRange(1, 1, 1, width).getValues()[0].map(value => String(value || '').trim());
  const sheetRow = existing?._sheetRow || (sheet.getLastRow() + 1);
  const partRow = partReqApiToRow_(record);
  const columnByHeader = new Map();
  currentHeaders.forEach((header, index) => { if (header) columnByHeader.set(header, index + 1); });

  // Preserve columns owned by other Sheet tooling, but update this Part row in one batch.
  const rowRange = sheet.getRange(sheetRow, 1, 1, width);
  const rowValues = rowRange.getValues()[0];
  const rowFormulas = rowRange.getFormulas()[0];
  rowFormulas.forEach((formula, index) => { if (formula) rowValues[index] = formula; });
  Object.entries(partRow).forEach(([header, value]) => {
    const column = columnByHeader.get(header);
    if (!column) return;
    rowValues[column - 1] = value === undefined || value === null ? '' : value;
  });

  rowRange.setValues([rowValues]);
  SpreadsheetApp.flush();
  const savedValues = rowRange.getValues()[0];
  const savedByHeader = {};
  currentHeaders.forEach((header, index) => { if (header) savedByHeader[header] = savedValues[index]; });
  if (String(savedByHeader.reqId || '').trim() !== partRow.reqId ||
      String(savedByHeader.status || '').trim() !== partRow.status ||
      String(savedByHeader.updatedAt || '').trim() !== partRow.updatedAt) {
    throw new Error('PART_WRITE_VERIFY_FAILED');
  }
  return partRow;
}

const PART_REQ_PUSH_SHEET_NAME = 'PushSubscriptions';
const PART_REQ_PUSH_HEADERS = ['endpoint', 'role', 'username', 'staffName', 'subscriptionJson', 'updatedAt'];

function partReqApiGetPushSheet_() {
  const spreadsheet = SpreadsheetApp.openById(PART_REQ_API_SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(PART_REQ_PUSH_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(PART_REQ_PUSH_SHEET_NAME);
  }
  const width = Math.max(sheet.getLastColumn(), PART_REQ_PUSH_HEADERS.length);
  const firstRow = sheet.getLastRow() >= 1 ? sheet.getRange(1, 1, 1, width).getValues()[0] : [];
  if (!firstRow.some(v => String(v || '').trim())) {
    sheet.getRange(1, 1, 1, PART_REQ_PUSH_HEADERS.length).setValues([PART_REQ_PUSH_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function partReqApiPushSubscribe_(session, subRecord) {
  const subscription = subRecord && subRecord.subscription ? subRecord.subscription : subRecord;
  const endpoint = String(subscription && subscription.endpoint || '').trim();
  if (!endpoint || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
    throw new Error('INVALID_PUSH_SUBSCRIPTION');
  }
  const role = String(subRecord.role || session.role || '').trim().toLowerCase() || 'requester';
  const username = String(subRecord.username || session.username || '').trim();
  const staffName = String(subRecord.staffName || '').trim();
  const nowStr = formatPartReqDateTime_(new Date().toISOString(), '', true);
  const subJson = JSON.stringify(subscription);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = partReqApiGetPushSheet_();
    const lastRow = sheet.getLastRow();
    let targetRow = lastRow + 1;
    if (lastRow >= 2) {
      const endpoints = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < endpoints.length; i++) {
        if (String(endpoints[i][0] || '').trim() === endpoint) {
          targetRow = i + 2;
          break;
        }
      }
    }
    sheet.getRange(targetRow, 1, 1, 6).setValues([[endpoint, role, username, staffName, subJson, nowStr]]);
    SpreadsheetApp.flush();
    return { ok: true, endpoint, role };
  } finally {
    lock.releaseLock();
  }
}

function partReqApiPushUnsubscribe_(endpointRaw) {
  const endpoint = String(endpointRaw || '').trim();
  if (!endpoint) return { ok: true, removed: 0 };
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = partReqApiGetPushSheet_();
    const lastRow = sheet.getLastRow();
    let removed = 0;
    if (lastRow >= 2) {
      const endpoints = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = endpoints.length - 1; i >= 0; i--) {
        if (String(endpoints[i][0] || '').trim() === endpoint) {
          sheet.deleteRow(i + 2);
          removed++;
        }
      }
    }
    return { ok: true, removed };
  } finally {
    lock.releaseLock();
  }
}

function partReqApiPushList_() {
  const sheet = partReqApiGetPushSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const rows = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const endpoint = String(row[0] || '').trim();
    const subJson = String(row[4] || '').trim();
    if (!endpoint || !subJson) continue;
    try {
      const subscription = JSON.parse(subJson);
      out.push({
        endpoint,
        role: String(row[1] || 'requester').trim().toLowerCase(),
        username: String(row[2] || '').trim(),
        staffName: String(row[3] || '').trim(),
        subscription,
        updatedAt: String(row[5] || '').trim()
      });
    } catch (_) {}
  }
  return out;
}

function partReqApiMessage_(result) {
  const payload = JSON.stringify(result).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const targetOrigin = JSON.stringify(PART_REQ_API_ALLOWED_ORIGIN);
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>try{if(window.top&&window.top!==window)window.top.postMessage(${payload},${targetOrigin});}catch(_){}try{if(window.parent&&window.parent.parent&&window.parent.parent!==window.top)window.parent.parent.postMessage(${payload},${targetOrigin});}catch(_){}try{window.parent.postMessage(${payload},${targetOrigin});}catch(_){}</script></body></html>`;
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
