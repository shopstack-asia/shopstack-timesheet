# Quick Setup Guide

## Prerequisites

- Node.js 18+ installed
- Google Cloud Console account
- Zoho People API access
- Google Sheet with proper structure
- (Optional) Slack workspace for reminders
- (Optional) SMTP server for email reminders

## Step-by-Step Setup

### 1. Clone and Install

```bash
cd timesheet
npm install
```

### 2. Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create/select project
3. Enable "Google+ API"
4. Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client ID"
5. Application type: "Web application"
6. Authorized redirect URIs:
   - `http://localhost:3000/api/auth/callback/google` (dev)
   - `https://yourdomain.com/api/auth/callback/google` (prod)
7. Copy Client ID and Client Secret

### 3. Google Sheets API Setup

1. In Google Cloud Console, enable "Google Sheets API"
2. Go to "IAM & Admin" → "Service Accounts"
3. Create new service account
4. Download JSON key file
5. Open JSON file and copy:
   - `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (keep `\n` as-is)
6. Share your Google Sheet with the service account email (Viewer or Editor)

### 4. Google Sheet Structure

Ensure your sheet has these tabs:

**Projects** (columns A-D):
- A: ProjectID
- B: ProjectClient
- C: ProjectName
- D: ProjectCode

**Roles and Tasks** (columns A-B):
- A: TaskID
- B: Task

**Time Log** (columns A-M):
- A: Time Log ID
- B: Date
- C: Staff ID
- D: Staff First Name
- E: Staff Last Name
- F: Staff Position
- G: Project ID
- H: Project Client
- I: Project Name
- J: Project Code
- K: Task ID
- L: Task
- M: Hours

### 5. Zoho People API Setup

1. Go to [Zoho API Console](https://api-console.zoho.com/)
2. Create new application
3. Select "Server-based Applications"
4. Add scopes: `ZohoPeople.employees.READ`
5. Generate refresh token
6. Copy:
   - Client ID → `ZOHO_CLIENT_ID`
   - Client Secret → `ZOHO_CLIENT_SECRET`
   - Refresh Token → `ZOHO_REFRESH_TOKEN`
   - API Domain → `ZOHO_API_DOMAIN` (usually `https://people.zoho.com`)

### 6. Environment Variables

Create `.env` file:

```env
# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=generate-random-secret-here

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret

# Google Sheets
GOOGLE_SHEETS_SPREADSHEET_ID=your-spreadsheet-id
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Zoho People
ZOHO_CLIENT_ID=your-zoho-client-id
ZOHO_CLIENT_SECRET=your-zoho-client-secret
ZOHO_REFRESH_TOKEN=your-refresh-token
ZOHO_API_DOMAIN=https://people.zoho.com

# Slack (optional)
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_CHANNEL_ID=C1234567890

# Email (optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
FROM_EMAIL=noreply@shopstack.asia

# Cron Secret
CRON_SECRET=generate-random-secret-for-cron
```

### 7. Generate Secrets

```bash
# Generate NEXTAUTH_SECRET
openssl rand -base64 32

# Generate CRON_SECRET
openssl rand -base64 32
```

### 8. Run Development Server

```bash
npm run dev
```

Visit `http://localhost:3000` and sign in with a @shopstack.asia email.

### 9. Deploy to Production

#### Vercel

1. Push code to GitHub
2. Import project in Vercel
3. Add all environment variables
4. Deploy

The `vercel.json` file will automatically configure the Friday reminder cron job.

#### Other Platforms

For other platforms, set up a cron job that calls:
```
POST https://yourdomain.com/api/cron/friday-reminder
Authorization: Bearer YOUR_CRON_SECRET
```

Schedule: `0 17 * * 5` (5 PM Friday, Asia/Bangkok timezone)

## Troubleshooting

### Authentication Issues

- Verify Google OAuth redirect URI matches exactly
- Check that email domain is @shopstack.asia
- Ensure employee exists in Zoho People

### Google Sheets Issues

- Verify service account has access to the sheet
- Check spreadsheet ID is correct
- Ensure sheet names match exactly (case-sensitive)

### Zoho People Issues

- Verify refresh token hasn't expired
- Check API domain is correct
- Ensure employee email matches Zoho People record

### Cron Job Issues

- Verify CRON_SECRET matches in environment and request header
- Check cron service timezone settings
- Verify Slack/email credentials if using reminders

## Support

For issues or questions, contact the Shopstack development team.

