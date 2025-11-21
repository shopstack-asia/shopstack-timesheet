# Shopstack Timesheet System

A complete timesheet management system for Shopstack employees built with Next.js, TypeScript, and Tailwind CSS.

## Features

- **Google SSO Authentication** - Secure login with domain restriction (@shopstack.asia)
- **Zoho People Integration** - Automatic staff profile retrieval
- **Google Sheets Integration** - Read projects/tasks, write time logs
- **Weekly Timesheet View** - Monday-Friday timesheet entry
- **Multiple Entries Per Day** - Log multiple projects and tasks
- **Copy Yesterday Feature** - Quickly duplicate previous day's entries
- **Friday Reminders** - Automated email and Slack notifications

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Variables

Copy `.env.example` to `.env` and fill in all required values:

```bash
cp .env.example .env
```

Required environment variables:
- `PORT` - Server port (default: 3000)
- `NEXTAUTH_URL` - Your application URL (must match PORT)
- `NEXTAUTH_SECRET` - Random secret for NextAuth
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - Google OAuth credentials
- `GOOGLE_SHEETS_SPREADSHEET_ID` - Your Google Sheet ID
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` - Service account email
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` - Service account private key
- `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` / `ZOHO_REFRESH_TOKEN` - Zoho People API credentials
- `SLACK_BOT_TOKEN` / `SLACK_CHANNEL_ID` - Slack integration (optional)
- `SMTP_*` - Email configuration for reminders (optional)
- `CRON_SECRET` - Secret for cron job authentication

### 3. Google Sheets Setup

Your Google Sheet should have the following sheets:
- **Projects** - Columns: ProjectID, ProjectClient, ProjectName, ProjectCode
- **Roles and Tasks** - Columns: TaskID, Task
- **Time Log** - Columns: Time Log ID, Date, Staff ID, Staff First Name, Staff Last Name, Staff Position, Project ID, Project Client, Project Name, Project Code, Task ID, Task, Hours

### 4. Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URI: `http://localhost:3000/api/auth/callback/google` (or your production URL)

### 5. Google Sheets API Setup

1. Create a service account in Google Cloud Console
2. Download the JSON key file
3. Share your Google Sheet with the service account email
4. Extract the email and private key from the JSON file

### 6. Zoho People API Setup

1. Go to [Zoho API Console](https://api-console.zoho.com/)
2. Create a new application
3. Generate refresh token
4. Use the client ID, client secret, and refresh token in environment variables

### 7. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Cron Job Setup

To set up the Friday reminder cron job, you can use:

### Vercel Cron

Add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/friday-reminder",
      "schedule": "0 17 * * 5"
    }
  ]
}
```

### Upstash Cron

1. Create an Upstash account
2. Add a new cron job
3. URL: `https://your-domain.com/api/cron/friday-reminder`
4. Schedule: `0 17 * * 5` (5 PM Friday, Asia/Bangkok)
5. Add header: `Authorization: Bearer YOUR_CRON_SECRET`

## Project Structure

```
src/
├── app/                    # Next.js app directory
│   ├── api/               # API routes
│   │   ├── auth/          # NextAuth routes
│   │   ├── master/        # Master data endpoints
│   │   ├── staff/         # Staff profile endpoint
│   │   ├── timesheet/     # Timesheet submission
│   │   └── cron/          # Cron jobs
│   ├── auth/              # Auth pages
│   └── timesheet/         # Main timesheet page
├── components/             # React components
│   ├── WeeklyTimesheet.tsx
│   ├── DailyCard.tsx
│   └── TimeEntryForm.tsx
├── lib/                    # Services and utilities
│   ├── auth.ts            # NextAuth configuration
│   ├── google-sheets.ts   # Google Sheets service
│   └── zoho-people.ts     # Zoho People service
└── types/                  # TypeScript types
    └── index.ts
```

## API Endpoints

- `GET /api/master/projects` - Get all projects
- `GET /api/master/tasks` - Get all tasks
- `GET /api/staff/profile` - Get current user's staff profile
- `POST /api/timesheet/submit` - Submit timesheet entries
- `POST /api/cron/friday-reminder` - Friday reminder cron job

## Development

- TypeScript for type safety
- Tailwind CSS for styling
- NextAuth for authentication
- Google Sheets API v4 for data storage
- Zoho People API for staff data

## Production Deployment

1. Set all environment variables in your hosting platform
2. Build the application: `npm run build`
3. Deploy to Vercel, Netlify, or your preferred platform
4. Set up cron job for Friday reminders

## License

Proprietary - Shopstack Internal Use Only

