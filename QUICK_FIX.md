# Quick Fix: Invalid OAuth Scope Error

## Current Status
✅ Refresh token is working  
❌ But has wrong scope (causing "Invalid OAuth Scope" error)

## Quick Solution

### Step 1: Exchange Your Code to Refresh Token

You have the code from Self Client. Now you need to exchange it for a refresh token.

**Option A: Using curl (Quick)**

Replace these values:
- `YOUR_CLIENT_ID` - from your .env file
- `YOUR_CLIENT_SECRET` - from your .env file  
- `YOUR_CODE` - the code you just generated (starts with `1000.`)

```bash
curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
  -d "grant_type=authorization_code" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "redirect_uri=http://localhost:3000" \
  -d "code=YOUR_CODE"
```

**Option B: Using the script**

```bash
./scripts/generate-zoho-refresh-token.sh YOUR_CODE
```

### Step 2: Copy the Refresh Token

From the response, copy the `refresh_token` value (starts with `1000.`)

Example response:
```json
{
  "access_token": "...",
  "refresh_token": "1000.abc123...",
  "expires_in": 3600
}
```

### Step 3: Update .env File

```env
ZOHO_REFRESH_TOKEN=1000.your-refresh-token-here
```

### Step 4: Restart Server

```bash
# Stop server (Ctrl+C)
npm run dev
```

### Step 5: Test

Try logging in again. The error should be fixed!

---

## Why This Happens

The code from Self Client is **NOT** the refresh token. You need to:
1. Generate code (✅ Done)
2. Exchange code for refresh token (⏳ Do this now)
3. Use refresh token in .env (⏳ Then do this)

The refresh token will have the correct scope (`ZohoPeople.employee.ALL`) and won't expire.

