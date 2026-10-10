import { redirect } from 'next/navigation';
import { WORKSPACE_ROUTES } from '@/lib/workspace/routes';

export default function ExpenseManagementIndexPage() {
  redirect(WORKSPACE_ROUTES.expenseManagementSummary);
}
