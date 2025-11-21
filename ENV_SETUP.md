# คู่มือการตั้งค่า Environment Variables (.env)

ไฟล์ `.env` ใช้เก็บค่าการตั้งค่าที่สำคัญของระบบ ต้องสร้างไฟล์นี้ก่อนรันแอป

## วิธีสร้างไฟล์ .env

```bash
cp .env.example .env
```

แล้วแก้ไขค่าต่างๆ ในไฟล์ `.env`

---

## ค่าที่จำเป็น (Required) - ต้องมีทุกตัว

### 1. Server Configuration

```env
PORT=3000
```

**วิธีตั้งค่า:**
- `PORT`: Port สำหรับรัน development server (default: 3000)
- ถ้าไม่ระบุจะใช้ port 3000 เป็นค่า default
- ตัวอย่าง: `PORT=3001` สำหรับรันบน port 3001

### 2. NextAuth Configuration

```env
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-here
```

**วิธีหา:**
- `NEXTAUTH_URL`: URL ของแอป (localhost สำหรับ dev, domain จริงสำหรับ production)
  - **สำคัญ:** ต้องตรงกับ PORT ที่ตั้งค่า (เช่น ถ้า PORT=3001 ให้ใช้ `http://localhost:3001`)
- `NEXTAUTH_SECRET`: สร้างด้วยคำสั่ง `openssl rand -base64 32`

---

### 3. Google OAuth

```env
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

**วิธีหา:**
1. ไปที่ [Google Cloud Console](https://console.cloud.google.com/)
2. สร้างโปรเจคใหม่หรือเลือกโปรเจคที่มีอยู่
3. ไปที่ **APIs & Services** > **Credentials**
4. คลิก **Create Credentials** > **OAuth 2.0 Client ID**
5. เลือก **Web application**
6. เพิ่ม **Authorized redirect URIs**: 
   - `http://localhost:3000/api/auth/callback/google` (dev)
   - `https://yourdomain.com/api/auth/callback/google` (prod)
7. คัดลอก **Client ID** และ **Client Secret**

---

### 4. Google Sheets API

```env
GOOGLE_SHEETS_SPREADSHEET_ID=your-spreadsheet-id
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

**วิธีหา Spreadsheet ID:**
- จาก URL ของ Google Sheet: `https://docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit`
- คัดลอกส่วน `[SPREADSHEET_ID]`

**วิธีสร้าง Service Account:**
1. ไปที่ [Google Cloud Console](https://console.cloud.google.com/)
2. ไปที่ **IAM & Admin** > **Service Accounts**
3. คลิก **Create Service Account**
4. ตั้งชื่อและคลิก **Create and Continue**
5. คลิก **Done**
6. คลิกที่ service account ที่สร้าง > **Keys** tab
7. คลิก **Add Key** > **Create new key** > เลือก **JSON**
8. ไฟล์ JSON จะถูกดาวน์โหลด
9. เปิดไฟล์ JSON และคัดลอก:
   - `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (คัดลอกมาแบบเดิมพร้อม `\n`)
10. **สำคัญ:** แชร์ Google Sheet กับ service account email (ให้สิทธิ์ Editor)

---

### 5. Zoho People API

```env
ZOHO_CLIENT_ID=your-client-id
ZOHO_CLIENT_SECRET=your-client-secret
ZOHO_REFRESH_TOKEN=your-refresh-token
ZOHO_API_DOMAIN=https://people.zoho.com
```

**วิธีหา:**
1. ไปที่ [Zoho API Console](https://api-console.zoho.com/)
2. คลิก **Add Client** > เลือก **Server-based Applications**
3. ตั้งชื่อและเลือก scopes: `ZohoPeople.employees.READ`
4. คลิก **Create**
5. คัดลอก **Client ID** และ **Client Secret**
6. สร้าง **Refresh Token**:
   - ไปที่ [Zoho OAuth Playground](https://api-console.zoho.com/playground)
   - เลือก **People** API
   - เลือก scope: `ZohoPeople.employees.READ`
   - คลิก **Generate Code**
   - คัดลอก code ที่ได้
   - ไปที่ **Generate Token** และวาง code
   - คัดลอก **Refresh Token**

---

### 6. Cron Secret

```env
CRON_SECRET=your-cron-secret
```

**วิธีสร้าง:**
```bash
openssl rand -base64 32
```

ใช้สำหรับป้องกัน cron job endpoint

---

## ค่าที่ไม่บังคับ (Optional)

### Slack Integration (สำหรับ Friday Reminder)

```env
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_CHANNEL_ID=C1234567890
```

**วิธีหา:**
1. ไปที่ [Slack API](https://api.slack.com/apps)
2. สร้าง App ใหม่
3. ไปที่ **OAuth & Permissions**
4. เพิ่ม Bot Token Scopes: `chat:write`
5. Install App to Workspace
6. คัดลอก **Bot User OAuth Token** → `SLACK_BOT_TOKEN`
7. คัดลอก Channel ID จาก Slack (คลิกขวาที่ channel > View channel details)

---

### Email Configuration (สำหรับ Friday Reminder)

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
FROM_EMAIL=noreply@shopstack.asia
```

**สำหรับ Gmail:**
1. เปิด [2-Step Verification](https://myaccount.google.com/security)
2. ไปที่ [App Passwords](https://myaccount.google.com/apppasswords)
3. สร้าง App Password สำหรับ "Mail"
4. ใช้ App Password แทนรหัสผ่านปกติ

---

## ตัวอย่างไฟล์ .env ที่สมบูรณ์

```env
# Server Configuration
PORT=3000

# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=abc123xyz456...

# Google OAuth
GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-abc123...

# Google Sheets
GOOGLE_SHEETS_SPREADSHEET_ID=1a2b3c4d5e6f7g8h9i0j
GOOGLE_SERVICE_ACCOUNT_EMAIL=timesheet@project.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n"

# Zoho People
ZOHO_CLIENT_ID=1000.ABC123...
ZOHO_CLIENT_SECRET=abc123def456...
ZOHO_REFRESH_TOKEN=1000.abc123...
ZOHO_API_DOMAIN=https://people.zoho.com

# Cron
CRON_SECRET=xyz789abc123...

# Optional: Slack
SLACK_BOT_TOKEN=xoxb-1234567890-1234567890123-abc123...
SLACK_CHANNEL_ID=C1234567890

# Optional: Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=noreply@shopstack.asia
SMTP_PASSWORD=abcd efgh ijkl mnop
FROM_EMAIL=noreply@shopstack.asia
```

---

## ตรวจสอบว่าตั้งค่าถูกต้อง

หลังจากสร้างไฟล์ `.env` แล้ว รัน:

```bash
npm run dev
```

ถ้ามี error เกี่ยวกับ environment variables ให้ตรวจสอบว่า:
1. ไฟล์ `.env` อยู่ในโฟลเดอร์ root ของโปรเจค
2. ค่าทั้งหมดถูกต้อง (ไม่มี space หรือ quote ผิด)
3. Private key มี `\n` ครบถ้วน

---

## Security Notes

⚠️ **สำคัญ:**
- อย่า commit ไฟล์ `.env` ลง Git (มีใน `.gitignore` แล้ว)
- ใช้ `.env.example` เป็น template เท่านั้น
- ใน production ให้ตั้งค่า environment variables ใน hosting platform (Vercel, Netlify, etc.)

