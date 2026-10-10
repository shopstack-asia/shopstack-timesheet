export function ExpensePlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="container mx-auto px-4 py-6">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h2>
      <p className="mt-3 max-w-2xl text-gray-700 dark:text-gray-300">{description}</p>
      <div className="mt-6 max-w-2xl rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
        Expense functionality will be implemented in a subsequent phase. This page does not load or store expense transactions.
      </div>
    </div>
  );
}
