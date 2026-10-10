import type { ExpenseEmployee } from '@/lib/expense/prototype/service';
import type { StaffProfile } from '@/types';

/** The signed-in Zoho People profile is the expense requester. Position is the business unit line. */
export function expenseEmployeeFromProfile(profile: StaffProfile): ExpenseEmployee {
  const id = profile.EmployeeID.trim();
  if (!id) throw new Error('Staff profile has no employee id');
  const name =
    [profile.FirstName, profile.LastName].map((part) => part.trim()).filter(Boolean).join(' ') ||
    profile.Nickname.trim() ||
    profile.Email.trim();
  return {
    id,
    code: id,
    name,
    businessUnit: profile.Position.trim(),
  };
}
