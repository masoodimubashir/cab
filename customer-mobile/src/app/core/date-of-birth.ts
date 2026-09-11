export const adultAgeMessage = 'You must be at least 18 years old to have a DreamCabs account.';

export function latestAdultBirthDate(today = new Date()): string {
  const year = today.getFullYear() - 18;
  const month = today.getMonth();
  const day = Math.min(today.getDate(), new Date(year, month + 1, 0).getDate());
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function dateOfBirthError(value: string, today = new Date()): string | null {
  if (!value) return `Please enter your date of birth. ${adultAgeMessage}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Please enter a valid date of birth.';
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(0);
  parsed.setFullYear(year, month - 1, day);
  if (year < 1 || parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    return 'Please enter a valid date of birth.';
  }
  return value > latestAdultBirthDate(today) ? adultAgeMessage : null;
}
