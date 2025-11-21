# 🔧 Google Sheets Setup Guide

## Error: "This operation is not supported for this document"

Error นี้มักเกิดจาก **Service Account ไม่มีสิทธิ์เข้าถึง Google Sheet**

## วิธีแก้ไข

### Step 1: ตรวจสอบ Service Account Email

ตรวจสอบว่า Service Account Email ใน `.env` ถูกต้อง:

```bash
cat .env | grep GOOGLE_SERVICE_ACCOUNT_EMAIL
```

ควรเห็น email ที่ลงท้ายด้วย `@project.iam.gserviceaccount.com`

### Step 2: Share Google Sheet กับ Service Account

1. เปิด Google Sheet ที่ต้องการใช้:
   ```
   https://docs.google.com/spreadsheets/d/1eqUT3JLzizjbRSjTw_0qX83oLcOb-e-V/edit
   ```

2. คลิกปุ่ม **Share** (มุมขวาบน)

3. ในช่อง "Add people and groups" ให้ใส่ **Service Account Email**:
   ```
   shopstack-timesheet-writer@timesheet-478915.iam.gserviceaccount.com
   ```
   (หรือ email ที่อยู่ใน `.env` ของคุณ)

4. เลือกสิทธิ์เป็น **Editor** หรือ **Viewer** (ถ้าต้องการแค่อ่าน)

5. คลิก **Send** (ไม่ต้องส่ง email ก็ได้)

### Step 3: ตรวจสอบ Sheet Names

ตรวจสอบว่า Google Sheet มี sheet ชื่อ:
- `Projects` (สำหรับ projects)
- `Roles and Tasks` (สำหรับ tasks)

ถ้าไม่มี ให้สร้าง sheet ใหม่ด้วยชื่อเหล่านี้

### Step 4: ตรวจสอบ Sheet Structure

#### Sheet: Projects
- Column A: ProjectID
- Column B: ProjectClient
- Column C: ProjectName
- Column D: ProjectCode

#### Sheet: Roles and Tasks
- Column A: TaskID
- Column B: Task

### Step 5: Restart Server

หลังจาก share Google Sheet แล้ว:

```bash
npm run dev
```

## Troubleshooting

### ถ้ายัง error อยู่

1. **ตรวจสอบ Service Account Email:**
   - ดูใน logs: `[Google Sheets] Using service account: ...`
   - ตรวจสอบว่า email ตรงกับที่ share ใน Google Sheet

2. **ตรวจสอบ Private Key:**
   - ตรวจสอบว่า `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` ใน `.env` มี `\n` ครบถ้วน
   - Private key ต้องอยู่ใน quotes: `"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"`

3. **ตรวจสอบ Spreadsheet ID:**
   - ตรวจสอบว่า `GOOGLE_SHEETS_SPREADSHEET_ID` ใน `.env` ถูกต้อง
   - Spreadsheet ID คือส่วนที่อยู่ระหว่าง `/d/` และ `/edit` ใน URL

4. **ทดสอบการเข้าถึง:**
   - ลองเปิด Google Sheet ด้วย Service Account email
   - ถ้าเปิดไม่ได้ แสดงว่าไม่ได้ share หรือ share ผิด

## ตัวอย่าง .env

```env
GOOGLE_SHEETS_SPREADSHEET_ID=1eqUT3JLzizjbRSjTw_0qX83oLcOb-e-V
GOOGLE_SERVICE_ACCOUNT_EMAIL=shopstack-timesheet-writer@timesheet-478915.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n"
```

## Important Notes

⚠️ **สำคัญ:**
- Service Account ต้องมีสิทธิ์ **Editor** หรือ **Viewer** ใน Google Sheet
- Sheet names (`Projects`, `Roles and Tasks`) ต้องตรงกับที่ระบุในโค้ด
- หลังจาก share Google Sheet แล้ว ต้อง restart server

