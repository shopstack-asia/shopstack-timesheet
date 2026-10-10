import { redirect } from 'next/navigation';
import { WORKSPACE_ROUTES } from '@/lib/workspace/routes';

export default function LegacyExpenseRequestsPage() {
  redirect(WORKSPACE_ROUTES.expenseMine);
}
