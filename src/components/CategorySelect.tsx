import Combobox from './Combobox';

export type Category = { id: string; name: string; is_income: boolean };

export const TRANSFER = 'transfer';

/**
 * Category picker. Includes "Transfer", which is a flag rather than a
 * category, so it stays out of spending.
 */
export default function CategorySelect({
  categories,
  ...props
}: {
  categories: Category[];
  value: string | null; // a category id, TRANSFER, or null
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const options = [...categories.map((c) => ({ value: c.id, text: c.name })), { value: TRANSFER, text: 'Transfer (not spending)' }];
  return <Combobox options={options} {...props} />;
}
