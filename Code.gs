/**
 * @OnlyCurrentDoc  — จำกัดสิทธิ์ให้สคริปต์เข้าถึงได้เฉพาะชีตนี้
 *
 * Theos Corporation — ระบบบริหารการลงทะเบียน "Solar ภาคประชาชน" (LINE OA @solarbytheos)
 * Google Apps Script ผูกกับ Google Sheet (Extensions > Apps Script)
 *
 * หน้าที่:
 *  1) API ให้ฟอร์ม LIFF  — action: register / status / checkRef
 *  2) Webhook ของ LINE   — จำ groupId ของกลุ่มทีมงานอัตโนมัติเมื่อเชิญบอทเข้ากลุ่ม
 *  3) เมนู "☀️ Solar CRM" ในชีต — ตั้งค่า, ทดสอบ, สรุปรายวัน
 *  4) เปลี่ยนสถานะในชีต → แจ้งลูกค้าใน LINE อัตโนมัติ
 *  5) รหัสผู้แนะนำ — ทีมออกรหัสในชีต "ผู้แนะนำ" ลูกค้ากรอกรหัสในฟอร์ม ระบบตรวจและผูกกับการลงทะเบียน
 *
 * ค่าลับเก็บใน Project Settings > Script Properties:
 *   LINE_CHANNEL_ACCESS_TOKEN  (Messaging API channel ของ @solarbytheos)
 *   LINE_LOGIN_CHANNEL_ID      (LINE Login channel ที่มี LIFF — ใช้ยืนยัน idToken)
 *   LIFF_ID                    (เช่น 2001234567-AbCdEfGh)
 *   TEAM_GROUP_ID              (ระบบกรอกให้เองเมื่อพิมพ์ #ตั้งกลุ่มทีม <รหัส> ในกลุ่ม LINE ทีมงาน)
 *   TEAM_SETUP_CODE            (สร้างจากเมนู "สร้างรหัสตั้งกลุ่มทีม" — ใช้ได้ครั้งเดียว)
 */

const SHEET = { LEADS: 'Leads', REF: 'ผู้แนะนำ', LISTS: 'ตั้งค่า', DASH: 'Dashboard', LOG: 'Log' };
const TICKET_PREFIX = 'SBT';
const SLA_HOURS = 24;
const MAX_REG_PER_USER_PER_DAY = 3;   // กันสแปม/กันโควตาข้อความ LINE หมด
const CONTACT_PHONE = '081-481-4114';
const REF_PREFIX = 'TH';                       // รหัสผู้แนะนำ เช่น TH7K2QM

// แพ็กเกจและราคา (รวม VAT) — ใช้คำนวณมูลค่าเบื้องต้นใน Dashboard
const PACKAGES = { '5kW 1 เฟส': 159000, '5kW 3 เฟส': 169000, '10kW 1 เฟส': 239000, '10kW 3 เฟส': 249000, 'ให้ทีมงานแนะนำ': 0 };

const STATUSES = ['ใหม่', 'ติดต่อแล้ว', 'นัดสำรวจหน้างาน', 'สำรวจแล้ว', 'เสนอราคาแล้ว', 'ยืนยันติดตั้ง',
  'ยื่นขอรับสิทธิ์ กฟน.', 'กำลังติดตั้ง', 'ติดตั้งเสร็จ', 'รอเปิดพื้นที่', 'ไม่สนใจ/ยกเลิก'];
const WON = ['ยืนยันติดตั้ง', 'ยื่นขอรับสิทธิ์ กฟน.', 'กำลังติดตั้ง', 'ติดตั้งเสร็จ'];
const CLOSED = WON.concat(['รอเปิดพื้นที่', 'ไม่สนใจ/ยกเลิก']);
const STATUS_COLORS = {
  'ใหม่': '#FFF3D1', 'ติดต่อแล้ว': '#E3EEFF', 'นัดสำรวจหน้างาน': '#E8E3FF', 'สำรวจแล้ว': '#E0F4F4',
  'เสนอราคาแล้ว': '#FFE8D6', 'ยืนยันติดตั้ง': '#D9F7D6', 'ยื่นขอรับสิทธิ์ กฟน.': '#CDEFE0',
  'กำลังติดตั้ง': '#C6EDC1', 'ติดตั้งเสร็จ': '#A9E4A1', 'รอเปิดพื้นที่': '#F3EEE2', 'ไม่สนใจ/ยกเลิก': '#ECECEC'
};
// ข้อความที่ส่งหาลูกค้าเมื่อทีมเปลี่ยนสถานะ (สถานะที่ไม่อยู่ในนี้จะไม่แจ้งลูกค้า)
const NOTIFY_CUSTOMER = {
  'ติดต่อแล้ว': 'ทีมงานได้รับเรื่องและติดต่อคุณแล้วค่ะ หากพลาดสาย โทรกลับ ' + CONTACT_PHONE + ' หรือทักแชทนี้ได้เลย',
  'นัดสำรวจหน้างาน': 'นัดสำรวจหน้างานฟรีเรียบร้อยแล้วค่ะ{SURVEY}\nทีมวิศวกรจะโทรแจ้งก่อนเข้าพื้นที่',
  'เสนอราคาแล้ว': 'ทีมงานจัดทำใบเสนอราคาและแบบระบบให้คุณเรียบร้อยแล้วค่ะ มีข้อสงสัยทักแชทได้ตลอด',
  'ยืนยันติดตั้ง': 'ขอบคุณที่ไว้วางใจ Theos Corporation ค่ะ ทีมงานจะเตรียมเอกสารยื่นขอรับสิทธิ์และแจ้งกำหนดการติดตั้งต่อไป',
  'ยื่นขอรับสิทธิ์ กฟน.': 'ทีมงานยื่นเอกสารขอรับสิทธิ์กับการไฟฟ้านครหลวงให้เรียบร้อยแล้วค่ะ อยู่ระหว่างการพิจารณา',
  'กำลังติดตั้ง': 'ทีมช่างเริ่มติดตั้งระบบ Solar ที่บ้านของคุณแล้วค่ะ',
  'ติดตั้งเสร็จ': 'ติดตั้งและส่งมอบระบบ Solar เรียบร้อยแล้วค่ะ ☀️ รับประกันระบบพร้อมล้างแผงฟรี 7 ปี',
  'รอเปิดพื้นที่': 'ขณะนี้โครงการเฟส 1 เปิดรับเฉพาะกรุงเทพฯ นนทบุรี และสมุทรปราการ เราบันทึกรายชื่อไว้แล้ว และจะแจ้งทันทีเมื่อเปิดรับในพื้นที่ของคุณค่ะ'
};

// คอลัมน์ (อ้างอิงตามชื่อหัวตาราง จึงย้าย/เพิ่มคอลัมน์ได้โดยไม่พัง)
const COLS = [
  ['ticket', 'รหัสเคส', 110], ['createdAt', 'วันที่ลงทะเบียน', 130], ['status', 'สถานะ', 150], ['owner', 'ผู้รับผิดชอบ', 130],
  ['nextAction', 'ขั้นตอนถัดไป / นัดหมาย', 220], ['surveyDate', 'วันนัดสำรวจ', 130], ['quoteValue', 'มูลค่า (บาท)', 110],
  ['teamNote', 'บันทึกทีม', 220],
  ['name', 'ชื่อ-นามสกุล', 160], ['phone', 'เบอร์โทร', 110], ['contactTime', 'เวลาสะดวก', 120],
  ['inArea', 'พื้นที่เฟส 1', 90], ['province', 'จังหวัด', 120], ['district', 'เขต/อำเภอ', 120], ['address', 'ที่อยู่', 200],
  ['buildingType', 'ประเภทบ้าน', 110], ['ownership', 'ผู้ลงทะเบียนเป็น', 130], ['roofType', 'หลังคา', 130],
  ['pkg', 'แพ็กเกจที่สนใจ', 120], ['phase', 'ระบบไฟ', 80], ['sellBack', 'ขายไฟคืนภาครัฐ', 150], ['ca', 'CA (กฟน.)', 110],
  ['financing', 'การชำระเงิน', 120], ['surveyDays', 'วันสะดวกสำรวจ', 130], ['timeline', 'ต้องการติดตั้งภายใน', 120],
  ['note', 'ข้อความจากลูกค้า', 220], ['referral', 'รู้จักจาก', 110],
  ['refCode', 'รหัสผู้แนะนำ', 100], ['refName', 'ผู้แนะนำ', 140],
  ['lineName', 'ชื่อ LINE', 120], ['userId', 'LINE userId', 140], ['updatedAt', 'อัปเดตล่าสุด', 130], ['consent', 'ยินยอม PDPA', 120]
];
const TEAM_COLS = ['status', 'owner', 'nextAction', 'surveyDate', 'quoteValue', 'teamNote'];

// ชีตผู้แนะนำ
const REF_COLS = [
  ['code', 'รหัสผู้แนะนำ', 110], ['createdAt', 'วันที่สมัคร', 130], ['refStatus', 'สถานะรหัส', 100],
  ['name', 'ชื่อ-นามสกุล', 160], ['phone', 'เบอร์โทร', 110], ['refType', 'ประเภท', 140],
  ['countAll', 'แนะนำทั้งหมด', 90], ['countWon', 'ยืนยันติดตั้งแล้ว', 110], ['rewardNote', 'ค่าแนะนำ / บันทึกทีม', 220]
];
const REF_STATUSES = ['ใช้งาน', 'ระงับ'];

/* =====================================================================
 *  HTTP entry points
 * ===================================================================*/
function doGet() {
  return json_({ ok: true, service: 'solarbytheos-leads', time: new Date().toISOString() });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_request' }); }

  // LINE webhook (มี events[])
  if (Array.isArray(body.events)) { handleWebhook_(body.events); return json_({ ok: true }); }

  try {
    const userId = resolveUser_(body);
    if (body.action === 'register') return json_(register_(body, userId));
    if (body.action === 'status') return json_({ ok: true, cases: listCases_(userId) });
    if (body.action === 'checkRef') return json_(checkRef_(body.code));
    return json_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    log_('ERROR', String(err && err.stack || err));
    return json_({ ok: false, error: String(err.message || err) });
  }
}

/* ---------- ยืนยันตัวตนผู้ใช้จาก LIFF idToken ---------- */
function resolveUser_(body) {
  const channelId = prop_('LINE_LOGIN_CHANNEL_ID');
  if (!channelId) return body.userId || '';           // โหมดทดสอบ (ยังไม่ตั้งค่า) — ต้องตั้งก่อนใช้งานจริง
  if (!body.idToken) throw new Error('missing_id_token');
  const res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post', payload: { id_token: body.idToken, client_id: channelId }, muteHttpExceptions: true
  });
  const data = JSON.parse(res.getContentText());
  if (res.getResponseCode() !== 200 || !data.sub) throw new Error('invalid_id_token');
  return data.sub;
}

/* =====================================================================
 *  Register
 * ===================================================================*/
function register_(body, userId) {
  const d = body.data || {};
  if (!d.name || !d.phone || !d.province || !d.district) throw new Error('missing_fields');
  if (!d.consent) throw new Error('consent_required');
  const inArea = d.inArea !== false;

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let ticket, rowIndex;
  try {
    const sh = sheet_(SHEET.LEADS);
    // กันกดส่งซ้ำ: ผู้ใช้ LINE หรือเบอร์เดิม ภายใน 10 นาที → คืนรหัสเดิม
    const dup = findRecentDuplicate_(sh, userId, d.phone);
    if (dup) return { ok: true, ticket: dup, duplicate: true, inArea: inArea };
    if (countRecentByUser_(sh, userId) >= MAX_REG_PER_USER_PER_DAY) throw new Error('too_many');

    ticket = nextTicket_();
    const now = new Date();
    const ref = d.refCode ? findReferrer_(d.refCode) : null;
    const validRef = !!(ref && ref.refStatus === 'ใช้งาน');
    const rec = Object.assign({}, d, {
      refCode: d.refCode ? String(d.refCode).toUpperCase().trim() : '',
      refName: d.refCode ? (validRef ? ref.name : '(รหัสไม่ถูกต้อง/ใช้ไม่ได้)') : '',
      ticket: ticket, createdAt: now, updatedAt: now,
      status: inArea ? 'ใหม่' : 'รอเปิดพื้นที่',
      inArea: inArea ? 'ใช่' : 'นอกพื้นที่',
      quoteValue: PACKAGES[d.pkg] || '',
      userId: userId,
      consent: 'ยินยอม ' + Utilities.formatDate(now, 'Asia/Bangkok', 'dd/MM/yyyy HH:mm')
    });
    const map = headerMap_(sh);
    const row = new Array(sh.getLastColumn()).fill('');
    Object.keys(map).forEach(k => {
      if (rec[k] === undefined || rec[k] === null) return;
      let v = rec[k];
      if (k === 'phone' || k === 'ca') v = v ? "'" + String(v).replace(/[^\d]/g, '') : '';
      else if (typeof v === 'string') v = safe_(v);
      row[map[k] - 1] = v;
    });
    sh.appendRow(row);
    rowIndex = sh.getLastRow();
    if (validRef) d._ref = ref;
  } finally {
    lock.releaseLock();
  }

  // แจ้งเตือน (ไม่ให้ error ของ LINE ทำให้การลงทะเบียนล้ม)
  try { notifyTeamNewLead_(ticket, d, rowIndex, inArea); } catch (err) { log_('NOTIFY_TEAM_FAIL', String(err)); }
  try { if (userId) pushCustomerConfirm_(userId, ticket, d, inArea); } catch (err) { log_('NOTIFY_CUSTOMER_FAIL', String(err)); }
  log_('REGISTER', ticket + ' ' + d.name + ' ' + d.district + ' ' + d.province + ' ' + (d.pkg || ''));
  return { ok: true, ticket: ticket, inArea: inArea };
}

function findRecentDuplicate_(sh, userId, phone) {
  const map = headerMap_(sh), last = sh.getLastRow();
  if (last < 2) return '';
  const from = Math.max(2, last - 50);
  const vals = sh.getRange(from, 1, last - from + 1, sh.getLastColumn()).getValues();
  const p = String(phone).replace(/[^\d]/g, '');
  for (let i = vals.length - 1; i >= 0; i--) {
    const r = vals[i], t = r[map.createdAt - 1];
    if (!(t instanceof Date) || Date.now() - t > 10 * 60 * 1000) continue;
    const same = (userId && r[map.userId - 1] === userId) || String(r[map.phone - 1]).replace(/[^\d]/g, '') === p;
    if (same) return r[map.ticket - 1];
  }
  return '';
}

function countRecentByUser_(sh, userId) {
  if (!userId) return 0;
  const map = headerMap_(sh), last = sh.getLastRow();
  if (last < 2) return 0;
  const from = Math.max(2, last - 300);
  return sh.getRange(from, 1, last - from + 1, sh.getLastColumn()).getValues()
    .filter(r => r[map.userId - 1] === userId && r[map.createdAt - 1] instanceof Date && Date.now() - r[map.createdAt - 1] < 864e5).length;
}

function nextTicket_() {
  const props = PropertiesService.getScriptProperties();
  const ym = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyMM');
  const key = 'SEQ_' + ym;
  const n = Number(props.getProperty(key) || 0) + 1;
  props.setProperty(key, String(n));
  return TICKET_PREFIX + '-' + ym + '-' + ('000' + n).slice(-4);
}

/* =====================================================================
 *  Status lookup (สำหรับหน้า "เช็กสถานะ")
 * ===================================================================*/
function listCases_(userId) {
  if (!userId) return [];
  const sh = sheet_(SHEET.LEADS);
  const map = headerMap_(sh);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  const g = (r, k) => map[k] ? r[map[k] - 1] : '';
  return vals.filter(r => g(r, 'userId') === userId).reverse().slice(0, 10).map(r => ({
    ticket: g(r, 'ticket'), status: g(r, 'status'),
    createdAt: g(r, 'createdAt') instanceof Date ? g(r, 'createdAt').toISOString() : String(g(r, 'createdAt')),
    province: g(r, 'province'), district: g(r, 'district'), pkg: g(r, 'pkg'),
    owner: g(r, 'owner'),               // ลูกค้าเห็นชื่อผู้ดูแล
    nextAction: g(r, 'nextAction')      // ลูกค้าเห็นข้อความ "ขั้นตอนถัดไป"
  }));
}

/* =====================================================================
 *  เปลี่ยนสถานะในชีต → แจ้งลูกค้า (Installable trigger: onEditInstalled)
 * ===================================================================*/
function onEditInstalled(e) {
  const sh = e.range.getSheet();
  if (sh.getName() !== SHEET.LEADS || e.range.getRow() < 2) return;
  const map = headerMap_(sh);
  const col = e.range.getColumn();
  if (!TEAM_COLS.some(k => map[k] === col)) return;

  for (let i = 0; i < e.range.getNumRows(); i++) {
    const r = e.range.getRow() + i;
    if (map.updatedAt) sh.getRange(r, map.updatedAt).setValue(new Date());
    if (col !== map.status) continue;
    const status = sh.getRange(r, map.status).getValue();
    const ticket = sh.getRange(r, map.ticket).getValue();
    log_('STATUS', ticket + ' → ' + status + ' โดย ' + (Session.getActiveUser().getEmail() || 'ทีมงาน'));
    const tpl = NOTIFY_CUSTOMER[status];
    const userId = map.userId ? sh.getRange(r, map.userId).getValue() : '';
    if (!tpl || !userId) continue;
    let survey = '';
    const sd = map.surveyDate ? sh.getRange(r, map.surveyDate).getValue() : '';
    if (sd instanceof Date) survey = '\nวันที่ ' + Utilities.formatDate(sd, 'Asia/Bangkok', 'dd/MM/yyyy') + (sd.getHours() ? ' เวลา ' + Utilities.formatDate(sd, 'Asia/Bangkok', 'HH:mm') + ' น.' : '');
    const next = map.nextAction ? sh.getRange(r, map.nextAction).getValue() : '';
    if (!survey && next && status === 'นัดสำรวจหน้างาน') survey = '\n' + next;
    try { pushStatusUpdate_(userId, ticket, status, tpl.replace('{SURVEY}', survey)); }
    catch (err) { log_('NOTIFY_STATUS_FAIL', ticket + ' ' + err); }
  }
}

/* =====================================================================
 *  รหัสผู้แนะนำ
 * ===================================================================*/
function readRefs_() {
  const sh = sheet_(SHEET.REF);
  const map = headerMap_(sh, REF_COLS);
  const last = sh.getLastRow();
  const vals = last > 1 ? sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues() : [];
  return { sh: sh, map: map, rows: vals.map((r, i) => {
    const o = { _row: i + 2 }; Object.keys(map).forEach(k => o[k] = r[map[k] - 1]); return o;
  })};
}

function findReferrer_(code) {
  code = String(code || '').toUpperCase().trim();
  if (!code) return null;
  return readRefs_().rows.filter(r => String(r.code).toUpperCase() === code)[0] || null;
}

function checkRef_(code) {
  const r = findReferrer_(code);
  if (!r || r.refStatus !== 'ใช้งาน') return { ok: true, valid: false };
  return { ok: true, valid: true, name: firstName_(r.name) };
}

// สูตรนับจำนวนที่แนะนำ / ยืนยันติดตั้งแล้ว (คำนวณสดในชีต)
function setRefFormulas_(sh, map, r) {
  const lm = headerMap_(sheet_(SHEET.LEADS));
  if (!lm.refCode || !lm.status) return;
  const RC = 'Leads!$' + colLetter_(lm.refCode) + ':$' + colLetter_(lm.refCode);
  const ST = 'Leads!$' + colLetter_(lm.status) + ':$' + colLetter_(lm.status);
  const A = '$' + colLetter_(map.code) + r;
  if (map.countAll) sh.getRange(r, map.countAll).setFormula('=COUNTIF(' + RC + ',' + A + ')');
  if (map.countWon) sh.getRange(r, map.countWon).setFormula('=' + WON.map(s => 'COUNTIFS(' + RC + ',' + A + ',' + ST + ',"' + s + '")').join('+'));
}

// เมนู: ออกรหัสให้แถวที่มีชื่อแต่ยังไม่มีรหัส + เติมสูตรนับ (ทีมพิมพ์รหัสเองก็ได้ เช่น TH-SALE01)
function issueRefCodes() {
  const refs = readRefs_(), m = refs.map;
  const used = {}; refs.rows.forEach(r => { if (r.code) used[String(r.code).toUpperCase()] = 1; });
  let n = 0;
  refs.rows.forEach(r => {
    if (!String(r.name).trim()) return;
    if (!r.code) {
      let code; do { code = REF_PREFIX + randomCode_(4); } while (used[code]);
      used[code] = 1; refs.sh.getRange(r._row, m.code).setValue(code); n++;
    }
    if (!r.createdAt && m.createdAt) refs.sh.getRange(r._row, m.createdAt).setValue(new Date());
    if (!r.refStatus && m.refStatus) refs.sh.getRange(r._row, m.refStatus).setValue('ใช้งาน');
    setRefFormulas_(refs.sh, m, r._row);
  });
  SpreadsheetApp.getUi().alert('ออกรหัสใหม่ ' + n + ' รายการ ✅\nส่งรหัสให้ผู้แนะนำ ลูกค้ากรอกรหัสนี้ในช่อง "รหัสผู้แนะนำ" ของฟอร์ม\nหรือใช้ลิงก์ ' + liffUrl_('') + '?ref=รหัส ระบบจะกรอกให้อัตโนมัติ');
}

function firstName_(n) { return String(n || '').trim().split(/\s+/)[0]; }
function randomCode_(len) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // ตัด 0 O 1 I ที่สับสนง่าย
  let s = ''; for (let i = 0; i < len; i++) s += A.charAt(Math.floor(Math.random() * A.length));
  return s;
}

/* =====================================================================
 *  LINE messaging
 * ===================================================================*/
function linePush_(to, messages) {
  const token = prop_('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token || !to) return;
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ to: to, messages: messages })
  });
  if (res.getResponseCode() !== 200) throw new Error('LINE ' + res.getResponseCode() + ' ' + res.getContentText());
}

function lineReply_(replyToken, messages) {
  const token = prop_('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) return;
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ replyToken: replyToken, messages: messages })
  });
}

function liffUrl_(view) {
  const id = prop_('LIFF_ID');
  return id ? 'https://liff.line.me/' + id + (view ? '?view=' + view : '') : 'https://line.me';
}

function kv_(k, v) {
  return { type: 'box', layout: 'baseline', spacing: 'sm', contents: [
    { type: 'text', text: k, size: 'sm', color: '#8A9499', flex: 3 },
    { type: 'text', text: String(v || '-'), size: 'sm', color: '#23282B', flex: 6, wrap: true }
  ]};
}

function notifyTeamNewLead_(ticket, d, row, inArea) {
  const groupId = prop_('TEAM_GROUP_ID');
  if (!groupId) return;
  const link = SpreadsheetApp.getActive().getUrl() + '#gid=' + sheet_(SHEET.LEADS).getSheetId() + '&range=A' + row;
  const phone = String(d.phone).replace(/[^\d]/g, '');
  const body = [
    kv_('ชื่อ', d.name), kv_('โทร', phone), kv_('สะดวก', d.contactTime),
    kv_('พื้นที่', d.district + ', ' + d.province), kv_('บ้าน', d.buildingType + ' · ' + d.ownership),
    kv_('แพ็กเกจ', d.pkg + (PACKAGES[d.pkg] ? ' (' + PACKAGES[d.pkg].toLocaleString() + ' บ.)' : '')),
    kv_('ระบบไฟ', d.phase), kv_('ขายไฟคืน', d.sellBack), kv_('ชำระเงิน', d.financing), kv_('วันสำรวจ', d.surveyDays)
  ];
  if (d.note) body.push(kv_('ข้อความ', d.note));
  if (d.refCode) body.push(kv_('ผู้แนะนำ', String(d.refCode).toUpperCase() + (d._ref ? ' · ' + d._ref.name : ' (รหัสใช้ไม่ได้)')));
  linePush_(groupId, [{
    type: 'flex', altText: (inArea ? '🔔 ลงทะเบียนใหม่ ' : '📋 ลงชื่อรอ (นอกพื้นที่) ') + ticket + ' — ' + d.name + ' (' + d.district + ')',
    contents: {
      type: 'bubble', size: 'kilo',
      header: { type: 'box', layout: 'vertical', backgroundColor: inArea ? '#0A9A16' : '#8A9499', paddingAll: '14px', contents: [
        { type: 'text', text: inArea ? '🔔 ลงทะเบียน Solar ภาคประชาชน' : '📋 ลงชื่อรอ — นอกพื้นที่เฟส 1', color: '#FFFFFF', weight: 'bold', size: 'md', wrap: true },
        { type: 'text', text: ticket, color: '#EFFFEE', size: 'xs' }
      ]},
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
      footer: { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
        { type: 'button', style: 'primary', color: '#0A9A16', height: 'sm', action: { type: 'uri', label: '📞 โทร', uri: 'tel:' + phone } },
        { type: 'button', style: 'secondary', height: 'sm', action: { type: 'uri', label: 'เปิดในชีต', uri: link } }
      ]}
    }
  }]);
}

function pushCustomerConfirm_(userId, ticket, d, inArea) {
  const msg = inArea
    ? 'ทีมงานจะติดต่อกลับที่เบอร์ ' + String(d.phone).replace(/(\d{3})(\d{3})(\d+)/, '$1-$2-$3') + ' ภายใน ' + SLA_HOURS + ' ชม. (วันทำการ) เพื่อนัดสำรวจหน้างานฟรี'
    : NOTIFY_CUSTOMER['รอเปิดพื้นที่'];
  linePush_(userId, [{
    type: 'flex', altText: 'ได้รับข้อมูลลงทะเบียนแล้ว รหัส ' + ticket,
    contents: {
      type: 'bubble', size: 'kilo',
      body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [
        { type: 'text', text: 'SOLAR ภาคประชาชน · THEOS', size: 'xxs', color: '#0A9A16', weight: 'bold' },
        { type: 'text', text: 'ได้รับข้อมูลลงทะเบียนแล้วค่ะ', weight: 'bold', size: 'lg', wrap: true },
        { type: 'text', text: ticket, size: 'xl', weight: 'bold', color: '#0A9A16' },
        { type: 'text', text: msg, size: 'sm', color: '#6B7579', wrap: true }
      ]},
      footer: { type: 'box', layout: 'vertical', contents: [
        { type: 'button', style: 'primary', color: '#0A9A16', action: { type: 'uri', label: 'เช็กสถานะ', uri: liffUrl_('status') } }
      ]}
    }
  }]);
}

function pushStatusUpdate_(userId, ticket, status, text) {
  linePush_(userId, [{
    type: 'flex', altText: 'อัปเดตสถานะ ' + ticket + ': ' + status,
    contents: {
      type: 'bubble', size: 'kilo',
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
        { type: 'text', text: 'อัปเดตสถานะ · ' + ticket, size: 'xs', color: '#8A9499' },
        { type: 'text', text: status, weight: 'bold', size: 'xl', color: '#0A9A16', wrap: true },
        { type: 'text', text: text, size: 'sm', wrap: true, color: '#23282B' }
      ]},
      footer: { type: 'box', layout: 'vertical', contents: [
        { type: 'button', style: 'link', color: '#0A9A16', action: { type: 'uri', label: 'ดูรายละเอียด', uri: liffUrl_('status') } }
      ]}
    }
  }]);
}

/* ---------- Webhook: จำกลุ่มทีมงาน ---------- */
// ความปลอดภัย: ใครก็เชิญ OA เข้ากลุ่มได้ และ Apps Script ตรวจลายเซ็น webhook ไม่ได้
// จึงตั้งกลุ่มทีมได้เฉพาะเมื่อพิมพ์ "#ตั้งกลุ่มทีม <รหัส>" ด้วยรหัสลับที่สร้างจากเมนูในชีต (ใช้ได้ครั้งเดียว)
// และตรวจกับ LINE API ว่าบอทอยู่ในกลุ่มนั้นจริง ส่วนกลุ่มอื่นที่เชิญบอทเข้าไป บอทจะออกเองทันที
function handleWebhook_(events) {
  const props = PropertiesService.getScriptProperties();
  events.forEach(ev => {
    const src = ev.source || {};
    if (src.type !== 'group' || !src.groupId) return;
    const team = props.getProperty('TEAM_GROUP_ID');
    const code = props.getProperty('TEAM_SETUP_CODE');
    const text = ev.type === 'message' && ev.message && ev.message.type === 'text' ? String(ev.message.text).trim() : '';
    const m = text.match(/^#ตั้งกลุ่มทีม\s+(\S+)$/);

    if (m && code && m[1] === code && botInGroup_(src.groupId)) {
      props.setProperty('TEAM_GROUP_ID', src.groupId);
      props.deleteProperty('TEAM_SETUP_CODE');           // รหัสใช้ได้ครั้งเดียว
      log_('TEAM_GROUP', 'ตั้งกลุ่มแจ้งเตือนใหม่');
      lineReply_(ev.replyToken, [{ type: 'text', text: '✅ ตั้งกลุ่มนี้เป็นกลุ่มรับแจ้งเตือนการลงทะเบียน Solar ภาคประชาชนแล้ว' }]);
      return;
    }
    if (src.groupId === team) return;                   // กลุ่มทีมจริง — ไม่ต้องทำอะไร
    // กลุ่มอื่น: ถ้ายังไม่มีรหัสตั้งกลุ่มรออยู่ ให้บอทออกจากกลุ่ม
    if (!code && (ev.type === 'join' || ev.type === 'message')) leaveGroup_(src.groupId);
  });
}

function botInGroup_(groupId) {
  const token = prop_('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) return false;
  const r = UrlFetchApp.fetch('https://api.line.me/v2/bot/group/' + encodeURIComponent(groupId) + '/summary',
    { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  return r.getResponseCode() === 200;
}

function leaveGroup_(groupId) {
  const token = prop_('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) return;
  UrlFetchApp.fetch('https://api.line.me/v2/bot/group/' + encodeURIComponent(groupId) + '/leave',
    { method: 'post', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  log_('LEFT_GROUP', 'ออกจากกลุ่มที่ไม่ใช่กลุ่มทีม');
}

// เมนู: สร้างรหัสลับสำหรับตั้ง/ย้ายกลุ่มทีม (ใช้ได้ครั้งเดียว หมดอายุเมื่อใช้)
function makeTeamSetupCode() {
  const code = randomCode_(8);
  PropertiesService.getScriptProperties().setProperty('TEAM_SETUP_CODE', code);
  SpreadsheetApp.getUi().alert('รหัสตั้งกลุ่มทีม: ' + code +
    '\n\n1) เชิญ @solarbytheos เข้ากลุ่ม LINE ทีมงาน\n2) พิมพ์ในกลุ่ม:  #ตั้งกลุ่มทีม ' + code +
    '\n\nรหัสใช้ได้ครั้งเดียว อย่าส่งให้คนนอก — ระหว่างที่มีรหัสรออยู่ บอทจะยังไม่ออกจากกลุ่มอื่นอัตโนมัติ');
}

/* =====================================================================
 *  สรุปรายวันเข้ากลุ่มทีม (ตั้งเวลาด้วย installTriggers)
 * ===================================================================*/
function dailySummary() {
  const groupId = prop_('TEAM_GROUP_ID');
  const sh = sheet_(SHEET.LEADS);
  const map = headerMap_(sh);
  const last = sh.getLastRow();
  const vals = last > 1 ? sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues() : [];
  const g = (r, k) => r[map[k] - 1];
  const now = new Date(), dayMs = 864e5;
  const todayStr = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyyMMdd');

  const newLeads = vals.filter(r => g(r, 'createdAt') instanceof Date && now - g(r, 'createdAt') < dayMs);
  const overdue = vals.filter(r => g(r, 'status') === 'ใหม่' && g(r, 'createdAt') instanceof Date && now - g(r, 'createdAt') > SLA_HOURS * 36e5);
  const surveys = vals.filter(r => g(r, 'surveyDate') instanceof Date && Utilities.formatDate(g(r, 'surveyDate'), 'Asia/Bangkok', 'yyyyMMdd') === todayStr);
  const open = vals.filter(r => CLOSED.indexOf(g(r, 'status')) < 0).length;
  const won = vals.filter(r => WON.indexOf(g(r, 'status')) >= 0).length;

  let text = '☀️ สรุปประจำวัน Solar ภาคประชาชน\n' + Utilities.formatDate(now, 'Asia/Bangkok', 'dd/MM/yyyy') +
    '\n\n• ลงทะเบียนใหม่ 24 ชม.: ' + newLeads.length + ' ราย (ในพื้นที่ ' + newLeads.filter(r => g(r, 'inArea') === 'ใช่').length + ')' +
    '\n• รวมทั้งหมด: ' + vals.length + ' ราย · กำลังดำเนินการ ' + open + ' · ยืนยันติดตั้งแล้ว ' + won +
    '\n• ผ่านรหัสผู้แนะนำ 24 ชม.: ' + newLeads.filter(r => map.refCode && g(r, 'refCode')).length + ' ราย' +
    '\n• นัดสำรวจวันนี้: ' + surveys.length + ' ราย';
  surveys.slice(0, 10).forEach(r => { text += '\n   - ' + g(r, 'ticket') + ' ' + g(r, 'name') + ' ' + g(r, 'district') + ' (' + (g(r, 'owner') || 'ยังไม่มีผู้ดูแล') + ')'; });
  text += '\n• ⚠️ เกิน ' + SLA_HOURS + ' ชม. ยังไม่ติดต่อ: ' + overdue.length + ' ราย';
  overdue.slice(0, 10).forEach(r => { text += '\n   - ' + g(r, 'ticket') + ' ' + g(r, 'name') + ' ' + g(r, 'district'); });
  if (overdue.length > 10) text += '\n   … และอีก ' + (overdue.length - 10) + ' ราย';

  if (groupId) linePush_(groupId, [{ type: 'text', text: text }]);
  return text;
}

/* =====================================================================
 *  Sheet setup & menu
 * ===================================================================*/
function onOpen() {
  SpreadsheetApp.getUi().createMenu('☀️ Solar CRM')
    .addItem('1) ตั้งค่าชีตครั้งแรก', 'setupSheets')
    .addItem('2) ติดตั้งทริกเกอร์ (แจ้งสถานะ + สรุปรายวัน)', 'installTriggers')
    .addSeparator()
    .addItem('สร้างรหัสตั้งกลุ่มทีม LINE', 'makeTeamSetupCode')
    .addItem('ทดสอบส่งแจ้งเตือนเข้ากลุ่มทีม', 'testTeamNotify')
    .addItem('ส่งสรุปประจำวันตอนนี้', 'menuDailySummary')
    .addItem('ดูเคสที่รอติดต่อ', 'filterOverdue')
    .addItem('ออกรหัสผู้แนะนำ (ชีตผู้แนะนำ)', 'issueRefCodes')
    .addItem('สร้าง Dashboard ใหม่', 'menuRebuildDashboard')
    .addToUi();
}

function setupSheets() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone('Asia/Bangkok');

  // --- Leads ---
  const sh = sheet_(SHEET.LEADS, true);
  ensureHeaders_(sh, COLS);
  const map = headerMap_(sh);
  const n = Math.max(sh.getMaxRows() - 1, 999);
  sh.setFrozenRows(1); sh.setFrozenColumns(2);
  sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#0B5D14').setWrap(true).setVerticalAlignment('middle');
  sh.setRowHeight(1, 42);
  COLS.forEach(c => { if (map[c[0]]) sh.setColumnWidth(map[c[0]], c[2]); });
  TEAM_COLS.forEach(k => map[k] && sh.getRange(1, map[k]).setBackground('#0A9A16'));   // คอลัมน์ที่ทีมกรอก
  if (map.createdAt) sh.getRange(2, map.createdAt, n).setNumberFormat('dd/MM/yyyy HH:mm');
  if (map.updatedAt) sh.getRange(2, map.updatedAt, n).setNumberFormat('dd/MM/yyyy HH:mm');
  if (map.surveyDate) sh.getRange(2, map.surveyDate, n).setNumberFormat('dd/MM/yyyy HH:mm')
    .setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build());
  if (map.phone) sh.getRange(2, map.phone, n).setNumberFormat('@');
  if (map.ca) sh.getRange(2, map.ca, n).setNumberFormat('@');
  if (map.quoteValue) sh.getRange(2, map.quoteValue, n).setNumberFormat('#,##0');

  // --- ตั้งค่า (รายการสถานะ + ทีมงาน) ---
  const ls = sheet_(SHEET.LISTS, true);
  if (ls.getLastRow() === 0) {
    ls.getRange(1, 1, 1, 2).setValues([['สถานะ', 'ทีมงาน (แก้ไขรายชื่อได้)']]).setFontWeight('bold').setBackground('#E3F8E2');
    ls.getRange(2, 1, STATUSES.length, 1).setValues(STATUSES.map(s => [s]));
    ls.getRange(2, 2, 3, 1).setValues([['ทีมขาย 1'], ['ทีมขาย 2'], ['วิศวกรสำรวจ']]);
    ls.setColumnWidths(1, 2, 200);
  }
  if (map.status) sh.getRange(2, map.status, n).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(ls.getRange('A2:A30'), true).setAllowInvalid(false).build());
  if (map.owner) sh.getRange(2, map.owner, n).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(ls.getRange('B2:B50'), true).setAllowInvalid(true).build());

  // สีตามสถานะ + เคสเกิน SLA
  const L = colLetter_(sh.getLastColumn());
  const S = colLetter_(map.status), C = colLetter_(map.createdAt);
  const all = sh.getRange('A2:' + L + (n + 1));
  const rules = Object.keys(STATUS_COLORS).map(s => SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$' + S + '2="' + s + '"').setBackground(STATUS_COLORS[s]).setRanges([all]).build());
  rules.unshift(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($' + S + '2="ใหม่",NOW()-$' + C + '2>' + (SLA_HOURS / 24) + ')')
    .setBackground('#FFD7D2').setFontColor('#B3261E').setBold(true).setRanges([all]).build());
  sh.setConditionalFormatRules(rules);
  if (!sh.getFilter()) sh.getRange('A1:' + L + (n + 1)).createFilter();

  setupRefSheet_();
  buildDashboard_();
  const lg = sheet_(SHEET.LOG, true);
  if (lg.getLastRow() === 0) lg.getRange(1, 1, 1, 3).setValues([['เวลา', 'ประเภท', 'รายละเอียด']]).setFontWeight('bold');
  ['Sheet1', 'แผ่น1', 'ชีต1'].forEach(nm => { const s = ss.getSheetByName(nm); if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s); });
  SpreadsheetApp.getUi().alert('ตั้งค่าชีตเรียบร้อย ✅\nขั้นต่อไป: เมนู ☀️ Solar CRM > 2) ติดตั้งทริกเกอร์');
}

function setupRefSheet_() {
  const rs = sheet_(SHEET.REF, true);
  ensureHeaders_(rs, REF_COLS);
  const m = headerMap_(rs, REF_COLS);
  const n = Math.max(rs.getMaxRows() - 1, 499);
  rs.setFrozenRows(1); rs.setFrozenColumns(1);
  rs.getRange(1, 1, 1, rs.getLastColumn()).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#0B5D14').setWrap(true).setVerticalAlignment('middle');
  rs.setRowHeight(1, 42);
  REF_COLS.forEach(c => { if (m[c[0]]) rs.setColumnWidth(m[c[0]], c[2]); });
  ['name', 'phone', 'refType', 'refStatus', 'rewardNote'].forEach(k => m[k] && rs.getRange(1, m[k]).setBackground('#0A9A16'));
  if (m.createdAt) rs.getRange(2, m.createdAt, n).setNumberFormat('dd/MM/yyyy HH:mm');
  if (m.phone) rs.getRange(2, m.phone, n).setNumberFormat('@');
  if (m.refStatus) rs.getRange(2, m.refStatus, n).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(REF_STATUSES, true).setAllowInvalid(false).build());
  for (let r = 2; r <= rs.getLastRow(); r++) setRefFormulas_(rs, m, r);   // ซ่อมสูตรแถวเดิม
}

function buildDashboard_() {
  const d = sheet_(SHEET.DASH, true);
  d.clear();
  const sh = sheet_(SHEET.LEADS);
  const map = headerMap_(sh);
  const col = k => 'Leads!' + colLetter_(map[k]) + '2:' + colLetter_(map[k]);
  const T = col('ticket'), S = col('status'), C = col('createdAt'), V = col('quoteValue');
  const wonCount = WON.map(s => 'COUNTIF(' + S + ',"' + s + '")').join('+');
  const wonValue = WON.map(s => 'SUMIFS(' + V + ',' + S + ',"' + s + '")').join('+');
  const header = (rng, labels) => d.getRange(rng).setValues([labels]).setFontWeight('bold').setBackground('#E3F8E2');
  const grouped = (k, cell, limit) => d.getRange(cell).setFormula('=IFERROR(QUERY({' + col(k) + ',' + T + '},"select Col1,count(Col2) where Col1<>\'\' group by Col1 order by count(Col2) desc' + (limit ? ' limit ' + limit : '') + ' label count(Col2) \'\'",0),"")');

  d.getRange('A1').setValue('☀️ Solar ภาคประชาชน — Dashboard การลงทะเบียน').setFontSize(16).setFontWeight('bold').setFontColor('#0B5D14');
  d.getRange('A2').setFormula('="อัปเดต "&TEXT(NOW(),"dd/mm/yyyy hh:mm")').setFontColor('#6B7579');

  const kpi = [
    ['ลงทะเบียนทั้งหมด', '=COUNTA(' + T + ')'],
    ['ใหม่วันนี้', '=COUNTIFS(' + C + ',">="&TODAY())'],
    ['7 วันล่าสุด', '=COUNTIFS(' + C + ',">="&TODAY()-6)'],
    ['รอติดต่อ', '=COUNTIF(' + S + ',"ใหม่")'],
    ['เกิน SLA ' + SLA_HOURS + ' ชม.', '=COUNTIFS(' + S + ',"ใหม่",' + C + ',"<"&NOW()-' + (SLA_HOURS / 24) + ')'],
    ['นัด/สำรวจแล้ว', '=COUNTIF(' + S + ',"นัดสำรวจหน้างาน")+COUNTIF(' + S + ',"สำรวจแล้ว")'],
    ['ยืนยันติดตั้ง', '=' + wonCount],
    ['Conversion (ในพื้นที่)', '=IFERROR(G5/(A5-COUNTIF(' + S + ',"รอเปิดพื้นที่")),0)'],
    ['มูลค่ายืนยันแล้ว (บาท)', '=' + wonValue]
  ];
  d.getRange(4, 1, 1, kpi.length).setValues([kpi.map(k => k[0])]).setFontColor('#6B7579').setFontSize(9).setWrap(true);
  kpi.forEach((k, i) => d.getRange(5, i + 1).setFormula(k[1]));
  d.getRange(5, 1, 1, kpi.length).setFontSize(20).setFontWeight('bold').setFontColor('#0A9A16');
  d.getRange('E5').setFontColor('#B3261E');
  d.getRange('H5').setNumberFormat('0.0%');
  d.getRange('I5').setNumberFormat('#,##0').setFontSize(16);
  d.getRange(4, 1, 2, kpi.length).setBackground('#F3F6F2').setHorizontalAlignment('center');

  // ตามสถานะ
  header('A8:B8', ['สถานะ', 'จำนวน']);
  STATUSES.forEach((s, i) => { d.getRange(9 + i, 1).setValue(s); d.getRange(9 + i, 2).setFormula('=COUNTIF(' + S + ',A' + (9 + i) + ')'); });
  // แพ็กเกจ
  header('D8:E8', ['แพ็กเกจที่สนใจ', 'จำนวน']); grouped('pkg', 'D9');
  // การชำระเงิน
  header('G8:H8', ['การชำระเงิน', 'จำนวน']); grouped('financing', 'G9');
  // เขต/อำเภอ
  header('D16:E16', ['เขต/อำเภอ (Top 15)', 'จำนวน']); grouped('district', 'D17', 15);
  // ผู้รับผิดชอบ
  header('G16:H16', ['ผู้รับผิดชอบ', 'เคส']); grouped('owner', 'G17');
  // ช่องทาง
  header('A22:B22', ['รู้จักจาก', 'จำนวน']); grouped('referral', 'A23');
  // ผู้ลงทะเบียน
  header('G24:H24', ['ผู้ลงทะเบียนเป็น', 'จำนวน']); grouped('ownership', 'G25');
  header('G29:H29', ['ขายไฟคืนภาครัฐ', 'จำนวน']); grouped('sellBack', 'G30');
  // ผู้แนะนำ
  header('D34:E34', ['ผู้แนะนำ (Top 15)', 'แนะนำ']); grouped('refName', 'D35', 15);
  d.getRange('A34').setValue('ลงทะเบียนผ่านผู้แนะนำ').setFontWeight('bold').setBackground('#E3F8E2');
  d.getRange('B34').setFormula('=COUNTIF(' + col('refCode') + ',"?*")').setFontWeight('bold');
  d.getRange('A35').setValue('ผู้แนะนำทั้งหมด');
  d.getRange('B35').setFormula("=MAX(COUNTA('" + SHEET.REF + "'!A:A)-1,0)");

  d.setColumnWidths(1, 9, 120);
  d.setColumnWidth(1, 160); d.setColumnWidth(4, 170); d.setColumnWidth(7, 170);
  d.setHiddenGridlines(true);
  SpreadsheetApp.getActive().setActiveSheet(d);
  SpreadsheetApp.getActive().moveActiveSheet(1);
}

function installTriggers() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(t => {
    if (['onEditInstalled', 'dailySummary'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onEditInstalled').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('dailySummary').timeBased().atHour(8).nearMinute(30).everyDays(1).inTimezone('Asia/Bangkok').create();
  SpreadsheetApp.getUi().alert('ติดตั้งทริกเกอร์แล้ว ✅\n• เปลี่ยนสถานะ → แจ้งลูกค้าใน LINE อัตโนมัติ\n• สรุปประจำวันเข้ากลุ่มทีมทุกวัน ~08:30 น.');
}

function testTeamNotify() {
  if (!prop_('TEAM_GROUP_ID')) { SpreadsheetApp.getUi().alert('ยังไม่มีกลุ่มทีม\nใช้เมนู "สร้างรหัสตั้งกลุ่มทีม LINE" แล้วทำตามขั้นตอน'); return; }
  notifyTeamNewLead_('SBT-TEST-0000', { name: 'ทดสอบ ระบบ', phone: '0800000000', contactTime: 'ช่วงเวลาไหนก็ได้', district: 'บางกรวย', province: 'นนทบุรี', buildingType: 'บ้านเดี่ยว', ownership: 'เจ้าของบ้าน', pkg: '5kW 1 เฟส', phase: '1 เฟส', financing: 'สินเชื่อออมสิน', surveyDays: 'เสาร์' }, 2, true);
  SpreadsheetApp.getUi().alert('ส่งข้อความทดสอบเข้ากลุ่มแล้ว');
}

function menuDailySummary() { SpreadsheetApp.getUi().alert(dailySummary()); }
function menuRebuildDashboard() { buildDashboard_(); }

function filterOverdue() {
  const sh = sheet_(SHEET.LEADS);
  const map = headerMap_(sh);
  const f = sh.getFilter() || sh.getDataRange().createFilter();
  f.setColumnFilterCriteria(map.status, SpreadsheetApp.newFilterCriteria().whenTextEqualTo('ใหม่').build());
  SpreadsheetApp.getActive().setActiveSheet(sh);
  SpreadsheetApp.getActive().toast('กรองเฉพาะสถานะ "ใหม่" แล้ว (แถวสีแดง = เกิน SLA) — ล้างตัวกรองได้ที่ไอคอนกรอง', 'Solar CRM', 6);
}

/* =====================================================================
 *  Helpers
 * ===================================================================*/
function sheet_(name, create) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh && create) sh = ss.insertSheet(name);
  if (!sh) throw new Error('ไม่พบชีต ' + name + ' — กรุณารันเมนู "ตั้งค่าชีตครั้งแรก"');
  return sh;
}

function headerMap_(sh, cols) {
  const lastCol = sh.getLastColumn();
  if (!lastCol) return {};
  const heads = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const byLabel = {}; (cols || COLS).forEach(c => byLabel[c[1]] = c[0]);
  const m = {};
  heads.forEach((h, i) => { const k = byLabel[String(h).trim()]; if (k) m[k] = i + 1; });
  return m;
}

// เพิ่มหัวคอลัมน์ที่ยังไม่มี (อัปเกรดชีตเดิมได้โดยไม่ลบข้อมูล)
function ensureHeaders_(sh, cols) {
  if (sh.getLastRow() === 0) { sh.getRange(1, 1, 1, cols.length).setValues([cols.map(c => c[1])]); return; }
  const m = headerMap_(sh, cols);
  const missing = cols.filter(c => !m[c[0]]);
  if (missing.length) sh.getRange(1, sh.getLastColumn() + 1, 1, missing.length).setValues([missing.map(c => c[1])]);
}

function colLetter_(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }
function safe_(v) { v = String(v).slice(0, 1000); return /^[=+\-@]/.test(v) ? "'" + v : v; } // กัน formula injection
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function log_(type, msg) {
  try { const sh = SpreadsheetApp.getActive().getSheetByName(SHEET.LOG); if (sh) sh.appendRow([new Date(), type, msg]); } catch (e) {}
}
