export type Category = { id: string; name: string; is_income: boolean };

export const TRANSFER = 'transfer';

/** Category menu, plus "Transfer" (a flag, not a category: kept out of spending). */
export default function CategorySelect({
  categories,
  value,
  onChange,
  label,
  disabled,
}: {
  categories: Category[];
  value: string | null; // a category id, TRANSFER, or null
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <select aria-label={label} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>
        Choose…
      </option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
      <option value={TRANSFER}>Transfer (not spending)</option>
    </select>
  );
}
