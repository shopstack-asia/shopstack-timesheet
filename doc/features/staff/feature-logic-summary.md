# Staff — feature logic summary

| Doc | Description |
|-----|-------------|
| [session-profile.md](./features/session-profile.md) | GET profile from session |
| [zoho-leave-normalization-and-apis.md](./features/zoho-leave-normalization-and-apis.md) | Leave APIs + FULL/HALF normalize + Redis |

## Related code

- `src/app/api/staff/profile/route.ts`
- `src/app/api/staff/leave/route.ts`
- `src/app/api/staff/leave/monthly/route.ts`
- `src/app/api/staff/leave/yearly/route.ts`
- `src/lib/leave-utils.ts`
- `src/lib/zoho-people.ts`
- `src/lib/redis.ts`
