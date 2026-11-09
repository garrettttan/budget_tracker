import Combobox from './Combobox';

export type Category = { id: string; name: string; is_income: boolean; group_name?: string | null };

export const TRANSFER = 'transfer';
/** No category at all, shown as "Uncategorized". */
export const UNCATEGORIZED = 'uncategorized';

/**
 * Category picker. "Uncategorized" means no category (value null), and
 * "Transfer" is a flag rather than a category, so it stays out of spending.
 * onChange gives a category id, UNCATEGORIZED or TRANSFER.
 */
export default function CategorySelect({
  categories,
  value,
  ...props
}: {
  categories: Category[];
  value: string | null; // a category id, TRANSFER, or null (Uncategorized)
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const options = [
    ...categories.map((c) => ({ value: c.id, text: c.name })),
    { value: UNCATEGORIZED, text: 'Uncategorized' },
    { value: TRANSFER, text: 'Transfer (not spending)' },
  ];
  return <Combobox options={options} value={value ?? UNCATEGORIZED} {...props} />;
}
