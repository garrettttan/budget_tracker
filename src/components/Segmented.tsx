import Button from './Button';

/**
 * Buttons joined into one outlined control, like a switch with its options
 * named: a filled highlight slides behind the picked one. Each option is a
 * pressed / not pressed button, so screen readers hear which is on.
 */
export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** names the group for screen readers */
  label: string;
}) {
  const at = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className="segmented" role="group" aria-label={label} style={{ '--n': options.length, '--at': at } as React.CSSProperties}>
      <span className="segmented-thumb" aria-hidden="true" />
      {options.map((o) => (
        <Button key={o.value} size="small" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </Button>
      ))}
    </div>
  );
}
