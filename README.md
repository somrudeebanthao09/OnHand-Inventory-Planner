# Material Planner · H9 Assembly

เว็บวางแผน On-Hand เทียบ BOM เพื่อเห็น Part ที่อาจขาดก่อนขึ้นผลิต รองรับหลาย Model ต่อแผนและ Safety stock แยก Part

## ไฟล์ในชุดนี้

- `Index.html` — หน้าเว็บ นำเข้า `.xlsx`, `.xls`, `.csv` หรือ `.tsv` และคำนวณใน browser ก่อนบันทึก
- `Code.gs` — หลังบ้าน Google Apps Script สำหรับเก็บ Inventory, BOM, Safety stock, แผนผลิต และประวัติใน Google Sheet
- `appsscript.json` — จำกัดการเข้าเว็บเฉพาะ Google Workspace โดเมนเดียวกับผู้เผยแพร่ และตรวจสอบอีเมล Google
- `OnHandSeed.js` — snapshot ในเครื่องจากไฟล์ On-Hand ล่าสุดที่มีใน Downloads สำหรับเปิดดูข้อมูลได้ทันที
- `xlsx.full.min.js` — ตัวอ่าน Excel ที่แนบไว้เพื่อให้นำเข้าไฟล์ได้แม้ไม่มีอินเทอร์เน็ต
- `On-Hand-template.csv`, `BOM-template.csv` — ตัวอย่างชื่อคอลัมน์ที่เว็บเข้าใจ

## ## ติดตั้งเป็นเว็บของคุณ

1. เปิด Google Sheet กลาง แล้วไปที่ **ส่วนขยาย → Apps Script**
2. วาง `Code.gs` ในไฟล์ `Code.gs` และสร้างไฟล์ HTML ชื่อ `Index` แล้ววางเนื้อหาจาก `Index.html`
3. ใน Apps Script Project Settings เปิดการแสดง `appsscript.json` แล้วแทนเนื้อหาด้วยไฟล์ในชุดนี้
4. ใช้บัญชี Google Workspace ขององค์กร รัน `setup()` หนึ่งครั้ง ผู้ที่รันครั้งแรกจะเป็น Admin และระบบจะเตรียมแท็บ `AccessRequests`
5. Deploy เป็น **Web app** โดยตั้ง **Execute as: Me** และ **Who has access: Anyone within [company domain]** แล้วเปิด URL `/exec` ที่ Google ให้
6. ผู้ใช้ใน Workspace โดเมนเดียวกันเปิด URL `/exec` ส่งคำขอด้วยบัญชี Google ของตน แล้วรอ Admin อนุมัติในเมนู **ตั้งค่าระบบ → คำขอใช้เว็บ** ก่อนจึงเข้าถึงข้อมูลได้
7. ใช้ **Deploy → Manage deployments → Edit → New version** ทุกครั้งหลังแก้โค้ด เพื่อให้ URL `/exec` ใช้เวอร์ชันใหม่

เว็บนี้ไม่ใช้บัญชี ChatGPT; ระบบตรวจอีเมล Google ของผู้ใช้ จำกัดผู้เข้าถึงไว้ในโดเมนเดียวกับผู้เผยแพร่ และตรวจสถานะอนุมัติฝั่ง Apps Script ก่อนให้เรียกอ่านหรือเขียนข้อมูล ผู้สมัครที่ยังไม่อนุมัติจะเข้าถึง Inventory, BOM หรือการบันทึกไม่ได้
ใช้งาน

1. หน้า **นำเข้าข้อมูล** เลือกไฟล์ On-Hand ที่ดาวน์โหลดจาก Kingdee เมื่อเปิดผ่าน URL ของ Apps Script และตรวจพบชื่อไฟล์/คอลัมน์ On-Hand ระบบจะบันทึกเฉพาะแท็บ Inventory และอ่านข้อมูลจาก Sheet กลับเข้าเว็บให้อัตโนมัติ หากตรวจคอลัมน์ไม่ได้ ระบบจะแสดงหน้าตรวจ mapping ให้ยืนยันก่อน พร้อมแสดงเวลาบันทึกและเวลาดึงข้อมูล
2. นำเข้า BOM Explosion แยกต่างหากเมื่อพร้อม โดยมีรหัส Model, รหัส Part, จำนวนใช้ต่อ Model และแผนก `H9 Assembly Production Line` หรือ `Assembly Production Line`
3. หน้า **Safety stock** กำหนดจำนวนกันชนราย Part
4. หน้า **จำลองแผนผลิต** เลือกแผนก เพิ่ม Model ได้หลายรุ่น และใส่จำนวนที่จะผลิต
5. ตารางผลแสดงยอด On-Hand, ยอดจอง, ยอดใช้ได้, Safety stock และจำนวนที่ควรเรียกเข้า

On-Hand ที่นำเข้าใหม่จะแทน snapshot เก่าทั้งชุด ส่วน BOM จะแทนเฉพาะแผนกที่อยู่ในไฟล์ และคง BOM ของอีกแผนกไว้ ในหน้าคลังเรียงคอลัมน์ Material, Material Name, Specification, Warehouse, Storage, Inventory SKU Quantity ตามลำดับ และแสดงแผนกที่ใช้ Part เพิ่มท้ายแถว โดยใช้ Department ใน On-Hand หากมี; หากไม่มีจะจับคู่จาก Department ใน BOM ด้วยรหัส Part

## ขอบเขตการดึงข้อมูลอัตโนมัติ

เมื่อเลือกไฟล์ On-Hand ที่ดาวน์โหลดไว้ เว็บ Apps Script จะตรวจชื่อไฟล์/หัวคอลัมน์ แล้วส่งเฉพาะแถว On-Hand เข้า Google Sheets และอ่านข้อมูลกลับมาแสดงทันที พร้อม timestamp ที่หน้าสถานะและประวัติการนำเข้า ปุ่ม **โหลดจาก Google Sheets** อ่านข้อมูลล่าสุดจากชีต และตัวตั้งเวลา 08:00 ทำงานเมื่อหน้าเว็บเปิดค้างอยู่ ระบบยังไม่ได้สั่ง Chrome เปิดเมนูรายงานหรือดาวน์โหลดจาก Kingdee โดยอัตโนมัติ เพราะต้องกำหนด URL/เมนูรายงานและวิธีรับไฟล์ก่อน การอ่านรายงานทำแบบอ่านอย่างเดียวและไม่มีคำสั่งเขียนกลับ Kingdee

หากเปิด `Index.html` โดยตรง (`file://`) เว็บจะแสดง snapshot On-Hand ใน `OnHandSeed.js` หรือข้อมูลล่าสุดที่นำเข้าใน browser เครื่องนั้นเท่านั้น ข้อมูลไม่ซิงก์เข้า Google Sheet และไม่แชร์ข้ามเครื่อง ให้ทุกคนเปิด URL เว็บแอป `/exec` เดียวกันและส่งคำขอใช้เว็บก่อน Admin อนุมัติ

## คอลัมน์ที่ต้องมี

ไฟล์ On-Hand ต้องมีอย่างน้อย Material (รหัส Part), Inventory Quantity และ Warehouse; Specification, Storage Bin, BUoM หรือ SKU เป็นข้อมูลเสริมที่ระบบจับคู่ให้อัตโนมัติได้หากมีในรายงาน โดยหน้าเว็บแสดงจำนวนพร้อม SKU/หน่วยในคอลัมน์ Inventory SKU Quantity หากรายงานเดิมใน Google Sheet ไม่มี Specification หรือ Storage คอลัมน์จะแสดงเป็น — จนกว่าจะนำเข้าไฟล์ Kingdee ที่มีข้อมูลดังกล่าว ส่วนหัวคอลัมน์อื่นยังเลือกจับคู่เองได้

ไฟล์ BOM ต้องมี `Department`, `Model Code`, `Material Code`, `Qty Per` (จำนวน Part ที่ใช้ต่อการผลิต Model 1 หน่วย); `Model Name`, `Material Name`, `Unit` เป็นคอลัมน์เสริม
