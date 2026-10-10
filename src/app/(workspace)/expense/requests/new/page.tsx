import { redirect } from 'next/navigation';
import { WORKSPACE_ROUTES } from '@/lib/workspace/routes';

export default function LegacyNewExpensePage() {
  redirect(WORKSPACE_ROUTES.expenseNew);
}
