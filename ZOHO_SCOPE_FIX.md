# Fix: Invalid OAuth Scope Error (Code 7218)

## Problem
You're seeing error: `Invalid OAuth Scope` (code 7218)

This means your refresh token was generated with the **wrong scope**.

## Solution

### The Correct Scope
You **MUST** use: `ZohoPeople.employee.ALL`

**NOT:** `ZohoPeople.employees.READ` (this will cause the error)

### Steps to Fix

1. **Go to Zoho API Console**
   - Visit [Zoho API Console](https://api-console.zoho.com/)
   - Select your application

2. **Generate New Code with Correct Scope**
   - Go to **Self Client** tab
   - In **Scope** field, enter: `ZohoPeople.employee.ALL`
   - Set expiry: `10 minutes` (or longer)
   - Click **CREATE**
   - Copy the generated code

3. **Exchange Code for Refresh Token**

   Using curl:
   ```bash
   curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
     -d "grant_type=authorization_code" \
     -d "client_id=YOUR_CLIENT_ID" \
     -d "client_secret=YOUR_CLIENT_SECRET" \
     -d "redirect_uri=http://localhost:3000" \
     -d "code=YOUR_GENERATED_CODE"
   ```

   Or use the script:
   ```bash
   ./scripts/generate-zoho-refresh-token.sh YOUR_GENERATED_CODE
   ```

4. **Update .env**
   ```env
   ZOHO_REFRESH_TOKEN=1000.your-new-refresh-token-here
   ```

5. **Restart Server**
   ```bash
   npm run dev
   ```

## Why This Happens

- Zoho People API requires specific scopes
- `ZohoPeople.employee.ALL` gives access to employee data
- `ZohoPeople.employees.READ` might not exist or have different permissions
- The scope used when generating the refresh token must match what the API expects

## Verification

After updating, test at:
```
http://localhost:3000/api/debug/zoho-token-test
```

Then try logging in again. The error should be resolved.

