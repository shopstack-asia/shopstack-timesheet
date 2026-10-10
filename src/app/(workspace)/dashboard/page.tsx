import Link from 'next/link';
import { APP_NAME } from '@/lib/workspace/branding';
import { WORKSPACE_ROUTES } from '@/lib/workspace/routes';

export default function DashboardPage() {
  return (
    <div className="container mx-auto px-4 py-6">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h2>
      <p className="mt-2 max-w-2xl text-gray-600 dark:text-gray-300">
        {APP_NAME} is the home for internal business modules. Timesheet is available now.
        Expense pages are placeholders for a later phase.
      </p>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 max-w-3xl">
        <li>
          <Link
            href={WORKSPACE_ROUTES.timesheet}
            className="block h-full rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:border-blue-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-500"
          >
            <span className="font-semibold text-gray-900 dark:text-white">My Timesheet</span>
            <span className="mt-1 block text-sm text-gray-600 dark:text-gray-300">
              Open the weekly timesheet.
            </span>
          </Link>
        </li>
        <li>
          <Link
            href={WORKSPACE_ROUTES.expenseMine}
            className="block h-full rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:border-blue-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-500"
          >
            <span className="font-semibold text-gray-900 dark:text-white">My Expense Requests</span>
            <span className="mt-1 block text-sm text-gray-600 dark:text-gray-300">
              Record expenses in this browser. Data stays on this device.
            </span>
          </Link>
        </li>
      </ul>
    </div>
  );
}
