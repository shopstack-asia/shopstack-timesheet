# 02 — Identity Auth Bridge

## Flow

1. Slack `users.info` for the event user (`users:read`, `users:read.email`)  
2. Read `profile.email`  
3. Require `@shopstack.asia`  
4. `ZohoPeopleService.getEmployeeByEmail`  
5. Build `AgentAuthContext { staff, source: 'slack', slackUserId }`

## Security

- Does **not** forge NextAuth cookies  
- EmployeeID never taken from user text  
- Pending writes bound to `slackUserId`; wrong user cannot confirm  
- Failed identity → clear Slack message; no Timesheet writes  

## Code

- `src/lib/slack/identity.ts`  
- `src/lib/timesheet/agent-auth.ts`
