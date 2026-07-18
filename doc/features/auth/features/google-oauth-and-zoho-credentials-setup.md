# Google OAuth and Zoho credentials setup

### Overview

How to configure Google OAuth and Zoho People credentials required for sign-in and staff profile loading.

### Business Purpose

Operators can provision auth integrations without relying on scattered root markdown guides.

### User Roles and Permissions

| Role | Access | Actions |
|------|--------|---------|
| Operator / developer | Zoho API Console, Google Cloud | Create OAuth clients and refresh tokens |

### Workflow

#### Google OAuth

1. [Google Cloud Console](https://console.cloud.google.com/) → Credentials → OAuth 2.0 Client ID (Web application).
2. Authorized redirect URIs:
   - Dev: `http://localhost:3000/api/auth/callback/google` (match `PORT` / `NEXTAUTH_URL`)
   - Prod: `https://yourdomain.com/api/auth/callback/google`
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET` (e.g. `openssl rand -base64 32`).

#### Zoho People app + refresh token

Employee lookup uses Forms API: `/people/api/forms/P_EmployeeView/records`.

1. [Zoho API Console](https://api-console.zoho.com/) → Add Client → **Server-based Applications** (or Self Client for token generation).
2. Generate authorization code with scope that matches Forms API access. **Required for this codebase:**
   - Primary: `ZOHOPEOPLE.forms.READ`
   - Alternatives to try if primary fails: `ZohoPeople.forms.READ`, or combined scopes including forms.READ
3. Exchange code for refresh token (code expires quickly; refresh token is long-lived until revoked):

```bash
./scripts/generate-zoho-refresh-token.sh YOUR_CODE
```

Or:

```bash
curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
  -d "grant_type=authorization_code" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "redirect_uri=http://localhost:3000" \
  -d "code=YOUR_CODE"
```

4. Set `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_API_DOMAIN` (region: `https://people.zoho.com` / `.in` / `.eu` / `.com.au`).
5. Restart server. Verify with `GET /api/debug/zoho-token-test` (see **ops** feature — unauthenticated).

### Validation Rules / troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| AccessDenied / domain | Email not `@shopstack.asia` | Use Shopstack Google account |
| AccessDenied / not in Zoho | No employee record | Add employee in Zoho People |
| Invalid OAuth Scope (7218) | Refresh token scope ≠ Forms API | Regenerate token with `ZOHOPEOPLE.forms.READ` |
| `invalid_code` / `invalid_grant` | Expired auth code or bad refresh token | Regenerate code/token |
| `invalid_client` | Wrong client id/secret | Match Zoho app credentials |

**Note:** Older notes mentioning only `ZohoPeople.employee.ALL` or only `ZohoPeople.employees.READ` are insufficient for the Forms endpoint this app uses.

### Operation Notes

- Template: `.env.example`
- Full env catalog: [ops/environment-variables.md](../../ops/features/environment-variables.md)
- Runtime behavior: [google-sso-domain-and-zoho-gate.md](./google-sso-domain-and-zoho-gate.md)

### Source Code References

- `src/lib/auth.ts`
- `src/lib/zoho-people.ts` (Forms `P_EmployeeView` records)
- `scripts/generate-zoho-refresh-token.sh`
- `.env.example`

### Required tests

- N/A (ops procedure)
