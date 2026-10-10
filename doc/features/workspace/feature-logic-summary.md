# Workspace — feature logic summary

| Doc | Description |
|-----|-------------|
| [workspace-layout-and-navigation.md](./features/workspace-layout-and-navigation.md) | Shared shell, menu, active state, responsive header |
| [role-authorization.md](./features/role-authorization.md) | EMPLOYEE / HR / ADMIN contract and default deny |
| [roles-and-permission.md](./features/roles-and-permission.md) | Settings role tags and which menus they reveal |
| [route-compatibility.md](./features/route-compatibility.md) | Existing URLs, authenticated home, deployment safety |

## Related code

- `src/lib/workspace/branding.ts`
- `src/lib/workspace/navigation.ts`
- `src/lib/workspace/authorization.ts`
- `src/lib/workspace/routes.ts`
- `src/components/workspace/layout/WorkspaceFrame.tsx`
- `src/components/workspace/layout/WorkspaceShell.tsx`
- `src/app/(workspace)/layout.tsx`
- `src/middleware.ts`
