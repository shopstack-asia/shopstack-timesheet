# 🔧 Solution: Invalid OAuth Scope Error (Code 7218)

## Problem
You're still getting "Invalid OAuth Scope" error even after regenerating refresh token.

## Root Cause
The scope used when generating the code from Self Client is **NOT matching** what the API endpoint requires.

## Solution: Use Correct Scope Format

### The Issue
When you generated the code, you used scope: `ZohoPeople.employee.ALL`

But the API endpoint `/people/api/forms/P_EmployeeView/records` might require a **different scope format**.

### Try These Scopes (One at a time)

#### Option 1: Use `ZohoPeople.employees.READ` (if available)
1. Go to Zoho API Console > Self Client
2. Generate new code with scope: `ZohoPeople.employees.READ`
3. Exchange code for refresh token
4. Update `.env` with new refresh token

#### Option 2: Use Full Scope Path
Try: `ZohoPeople.employee.ALL,ZohoPeople.employees.READ`

#### Option 3: Check Your Zoho Account Region
If your Zoho account is in a different region, you might need:
- **India**: `https://people.zoho.in`
- **Europe**: `https://people.zoho.eu`
- **Australia**: `https://people.zoho.com.au`

Update `ZOHO_API_DOMAIN` in `.env` accordingly.

### Step-by-Step Fix

1. **Go to Zoho API Console**
   - Visit [Zoho API Console](https://api-console.zoho.com/)
   - Select your application

2. **Generate New Code with Different Scope**
   - Go to **Self Client** tab
   - Try scope: `ZohoPeople.employees.READ` (if available)
   - Or try: `ZohoPeople.employee.ALL,ZohoPeople.employees.READ`
   - Click **CREATE**
   - Copy the code

3. **Exchange Code for Refresh Token**
   ```bash
   curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
     -d "grant_type=authorization_code" \
     -d "client_id=YOUR_CLIENT_ID" \
     -d "client_secret=YOUR_CLIENT_SECRET" \
     -d "redirect_uri=http://localhost:3000" \
     -d "code=YOUR_NEW_CODE"
   ```

4. **Update .env**
   ```env
   ZOHO_REFRESH_TOKEN=1000.your-new-refresh-token
   ```

5. **Restart Server**
   ```bash
   npm run dev
   ```

## Alternative: Check Zoho People API Documentation

Visit: https://www.zoho.com/people/api/

Check:
- What scopes are available for People API
- What scope is required for `/api/forms/P_EmployeeView/records` endpoint
- If there's a different endpoint you should use

## Debug: Check What Scope Your Token Has

After refreshing token, check the response. It should show:
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "scope": "ZohoPeople.employee.ALL_AaaServer.profile.Read"
}
```

The `scope` field shows what permissions your token actually has.

## If Still Not Working

The endpoint `/people/api/forms/P_EmployeeView/records` might:
1. Require a different scope format
2. Not be available with your Zoho People plan
3. Require additional permissions in Zoho People settings

**Contact Zoho Support** or check your Zoho People API documentation for the correct scope and endpoint.

