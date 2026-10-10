import { redirect } from 'next/navigation';
import { WORKSPACE_ROUTES } from '@/lib/workspace/routes';

export default function SettingsIndexPage() {
  redirect(WORKSPACE_ROUTES.settingsRoles);
}
