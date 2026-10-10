import { CLAIM_FORM_FOOTNOTE, CLAIM_FORM_REFERENCE_ROWS, type ClaimFormInput } from '@/lib/expense/pdf/claim-form';
import { SHOPSTACK_LOGO_PNG_BASE64 } from '@/lib/expense/pdf/shopstack-logo';
import { formatMoney } from '@/lib/expense/prototype/money';

function displayDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

const headerCell = 'border border-neutral-500 bg-[#5b9bd5] px-1 py-1 text-center text-[11px] font-semibold text-white';
const bodyCell = 'border border-neutral-500 px-1 py-1 align-top text-[11px] text-neutral-900';

export function ClaimFormSheet({ form }: { form: ClaimFormInput }) {
  return (
    <article className="mt-4 overflow-x-auto rounded border border-neutral-300 bg-white p-4 text-neutral-900 shadow-sm sm:p-6">
      <div className="min-w-[720px]">
        <div className="flex items-start justify-between gap-4">
          <div
            role="img"
            aria-label="Shopstack"
            className="h-[33px] w-[280px] bg-contain bg-left bg-no-repeat"
            style={{ backgroundImage: `url("data:image/png;base64,${SHOPSTACK_LOGO_PNG_BASE64}")` }}
          />
          {form.claimNumber ? <p className="text-xs text-neutral-600">{form.claimNumber}</p> : <span />}
        </div>
        <hr className="mt-2 border-neutral-900" />
        <h3 className="mt-3 text-center text-base font-bold tracking-wide">EXPENSE CLAIM FORM</h3>
        <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <Field label="Name :" value={form.employeeName} />
          <Field label="Business Unit :" value={form.businessUnit} />
          <Field label="Purpose :" value={form.purpose} />
          <Field label="Date :" value={displayDate(form.claimDate)} />
        </div>
        <table className="mt-4 w-full border-collapse">
          <colgroup>
            <col className="w-[8%]" />
            <col className="w-[16%]" />
            <col className="w-[8%]" />
            <col className="w-[29%]" />
            <col className="w-[8%]" />
            <col className="w-[11%]" />
            <col className="w-[9%]" />
            <col className="w-[11%]" />
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2} className={headerCell}>Date</th>
              <th rowSpan={2} className={headerCell}>Expense</th>
              <th className={headerCell}>Expense</th>
              <th rowSpan={2} className={headerCell}>Explanation</th>
              <th colSpan={2} className={headerCell}>Amount (Currency)</th>
              <th rowSpan={2} className={headerCell}>Ex. Rate</th>
              <th className={headerCell}>Amount</th>
            </tr>
            <tr>
              <th className={headerCell}>Code</th>
              <th className={headerCell}>Currency</th>
              <th className={headerCell}>Amount</th>
              <th className={headerCell}>(THB)</th>
            </tr>
          </thead>
          <tbody>
            {form.rows.map((row, index) => {
              const stripe = index % 2 === 1 ? 'bg-[#d9eaf7]' : 'bg-white';
              return (
                <tr key={`${row.date}-${row.code}-${index}`}>
                  <td className={`${bodyCell} text-center ${stripe}`}>{displayDate(row.date)}</td>
                  <td className={`${bodyCell} ${stripe}`}>{row.expense}</td>
                  <td className={`${bodyCell} bg-[#add8e6] text-center`}>{row.code}</td>
                  <td className={`${bodyCell} ${stripe}`}>{row.explanation}</td>
                  <td className={`${bodyCell} text-center ${stripe}`}>{row.currency}</td>
                  <td className={`${bodyCell} text-right ${stripe}`}>{formatMoney(row.amount)}</td>
                  <td className={`${bodyCell} text-right ${stripe}`}>{row.exchangeRate}</td>
                  <td className={`${bodyCell} text-right ${stripe}`}>{formatMoney(row.amountThb)}</td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={7} className={`${bodyCell} text-right font-bold`}>Total Expenses</td>
              <td className={`${bodyCell} text-right font-bold`}>{formatMoney(form.totalThb)}</td>
            </tr>
            <tr>
              <td colSpan={7} className={`${bodyCell} text-right font-bold`}>Total Claimed / (Returned)</td>
              <td className={`${bodyCell} text-right font-bold`}>{formatMoney(form.totalThb)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-3 text-[11px]">{CLAIM_FORM_FOOTNOTE}</p>
        <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-6 text-sm">
            {['( Employee )', '( Dept. Manager )', '( COO or CFO if >USD300 )'].map((label) => (
              <div key={label}>
                <div className="flex items-end gap-2">
                  <span>Signature :</span>
                  <span className="inline-block w-40 border-b border-neutral-900" />
                </div>
                <p className="mt-1 pl-[4.6rem] text-xs text-neutral-600">{label}</p>
              </div>
            ))}
          </div>
          <table className="w-full max-w-xs border-collapse text-[11px]">
            <thead>
              <tr>
                <th className={headerCell}>EXPENSES</th>
                <th className={`${headerCell} w-16`}>CODE</th>
              </tr>
            </thead>
            <tbody>
              {CLAIM_FORM_REFERENCE_ROWS.map(([name, code]) => (
                <tr key={code}>
                  <td className={bodyCell}>{name}</td>
                  <td className={`${bodyCell} text-center`}>{code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </article>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex min-w-0 gap-2">
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 flex-1 border-b border-neutral-900">{value}</span>
    </p>
  );
}
