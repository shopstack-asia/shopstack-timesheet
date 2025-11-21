# How to Regenerate Zoho Refresh Token

## Problem
If you see error `invalid_code` or `invalid_grant`, it means your Zoho refresh token has expired or is invalid.

## Solution: Generate New Refresh Token

### Step 1: Go to Zoho API Console
1. Visit [Zoho API Console](https://api-console.zoho.com/)
2. Sign in with your Zoho account

### Step 2: Select Your Application
1. Find your application in the list
2. Click on it to open details

### Step 3: Generate Refresh Token

#### Option A: Using Self Client (Recommended for Server Applications)

**Step 3a: Generate Code**
1. In your application settings, go to **Self Client** tab
2. Enter scope: `ZOHOPEOPLE.forms.READ` ⚠️ **Important: Use this exact scope for Forms API**
   - Alternative: Try `ZohoPeople.forms.READ` if the above doesn't work
   - For Forms API endpoint `/people/api/forms/P_EmployeeView/records`, you need forms.READ scope
3. Set code expiry: `10 minutes` (or longer)
4. Add description: "Timesheet Integration" (optional)
5. Click **CREATE**
6. **Copy the generated code** (starts with `1000.`) - ⚠️ This code expires in 10 minutes!

**Step 3b: Exchange Code for Refresh Token**
1. Open terminal or use curl/Postman
2. Make a POST request to exchange the code for tokens:

```bash
curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
  -d "grant_type=authorization_code" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "redirect_uri=YOUR_REDIRECT_URI" \
  -d "code=1000.YOUR_GENERATED_CODE_HERE"
```

3. From the response, copy the **refresh_token** (starts with `1000.`)
4. This refresh token doesn't expire (unless revoked)

#### Option B: Using OAuth Playground
1. Go to [Zoho OAuth Playground](https://api-console.zoho.com/playground)
2. Select **People** API from the dropdown
3. Select scope: `ZOHOPEOPLE.forms.READ` ⚠️ **Must use this scope for Forms API**
   - Alternative: Try `ZohoPeople.forms.READ` if the above doesn't work
4. Click **Generate Code**
5. Copy the authorization code
6. Paste it in the **Code** field
7. Click **Generate Token**
8. Copy the **Refresh Token** (starts with `1000.`)

**⚠️ Important:** For Forms API endpoint (`/people/api/forms/P_EmployeeView/records`), you need `ZOHOPEOPLE.forms.READ` scope. If you use a different scope, you'll get "Invalid OAuth Scope" error (code 7218).

### Step 4: Update Environment Variables
1. Open `.env` file
2. Update `ZOHO_REFRESH_TOKEN` with the new token:
   ```env
   ZOHO_REFRESH_TOKEN=1000.your-new-refresh-token-here
   ```
3. Restart your development server

### Step 5: Verify
1. Restart dev server: `npm run dev`
2. Try logging in again
3. Check terminal logs for any errors

## Important Notes

- **Refresh tokens don't expire** (unless revoked), but they can become invalid if:
  - The application is deleted or modified
  - The client secret is regenerated
  - The token is manually revoked

- **Client ID and Client Secret** must match the application that generated the refresh token

- **API Domain** should match your Zoho account region:
  - `https://people.zoho.com` (US)
  - `https://people.zoho.in` (India)
  - `https://people.zoho.eu` (Europe)
  - `https://people.zoho.com.au` (Australia)

## Troubleshooting

### Error: "invalid_code"
- Refresh token is expired or invalid
- Solution: Generate new refresh token

### Error: "invalid_client"
- Client ID or Client Secret is incorrect
- Solution: Verify credentials in `.env` file

### Error: "Invalid OAuth Scope" (code 7218)
- The refresh token was generated with wrong scope
- Solution: Regenerate refresh token with scope `ZOHOPEOPLE.forms.READ` (for Forms API)
  - Alternative: Try `ZohoPeople.forms.READ` if the above doesn't work
  - The scope must match the API endpoint you're using

### Error: "unauthorized_client"
- Application doesn't have required scopes
- Solution: Ensure `ZohoPeople.employee.ALL` scope is enabled

### Error: 401 Unauthorized
- Access token is invalid (usually means refresh token failed)
- Solution: Regenerate refresh token

## Testing Refresh Token

You can test if your refresh token works by visiting:
```
http://localhost:3000/api/debug/zoho-token-test
```

This will show you if the token refresh is working correctly.

