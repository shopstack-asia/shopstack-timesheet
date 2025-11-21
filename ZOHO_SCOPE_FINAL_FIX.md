# 🔧 Final Fix: Invalid OAuth Scope Error (Code 7218)

## Problem
You're getting "Invalid OAuth Scope" (code 7218) when trying to access `/people/api/forms/P_EmployeeView/records`.

## Root Cause
The scope `ZohoPeople.employee.ALL` is **NOT the correct scope** for accessing Zoho People Forms API.

## ✅ The Correct Scope

For accessing **Zoho People Forms API** (like `/people/api/forms/P_EmployeeView/records`), you need:

**`ZOHOPEOPLE.forms.READ`**

**NOT:** `ZohoPeople.employee.ALL` (this is for a different API endpoint)

## Step-by-Step Fix

### Step 1: Go to Zoho API Console
1. Visit [Zoho API Console](https://api-console.zoho.com/)
2. Sign in with your Zoho account
3. Select your application

### Step 2: Generate New Code with Correct Scope
1. Go to **Self Client** tab
2. In **Scope** field, enter: **`ZOHOPEOPLE.forms.READ`** ⚠️ **Use this exact scope**
3. Set expiry: `10 minutes` (or longer)
4. Click **CREATE**
5. **Copy the generated code** (starts with `1000.`) - ⚠️ This code expires in 10 minutes!

### Step 3: Exchange Code for Refresh Token

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

### Step 4: Update .env
```env
ZOHO_REFRESH_TOKEN=1000.your-new-refresh-token-here
```

### Step 5: Restart Server
```bash
npm run dev
```

## Verification

1. Test token refresh:
   ```
   http://localhost:3000/api/debug/zoho-token-test
   ```
   Check that `scope` includes `ZOHOPEOPLE.forms.READ`

2. Try logging in again

## Alternative Scopes to Try

If `ZOHOPEOPLE.forms.READ` doesn't work, try these (one at a time):

1. `ZohoPeople.forms.READ` (without "ZOHO" prefix)
2. `ZohoPeople.forms.ALL`
3. `ZohoPeople.employee.ALL,ZohoPeople.forms.READ` (multiple scopes)

## Why This Happens

- Zoho People API has different scopes for different endpoints
- Forms API (`/people/api/forms/...`) requires `ZOHOPEOPLE.forms.READ` scope
- Employee API (if exists) might require `ZohoPeople.employee.ALL`
- The scope used when generating refresh token **must match** what the API endpoint requires

## Important Notes

- **Scope format matters**: `ZOHOPEOPLE.forms.READ` vs `ZohoPeople.forms.READ` might be different
- **Refresh token inherits scope**: The refresh token will have the same scope as the authorization code
- **You must regenerate**: Old refresh tokens won't work with new scopes

