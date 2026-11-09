import Button from './Button';

/**
 * A Settings section reduced to one full-width row that opens its page:
 * "Merchants ……… 265 ›". Rows placed next to each other share their rules.
 */
export default function SettingsRow({ label, detail, onOpen }: { label: string; detail?: string; onOpen: () => void }) {
  return (
    <Button variant="link" className="settings-row" aria-label={detail ? `${label}, ${detail}` : label} onClick={onOpen}>
      <span className="settings-row-label">{label}</span>
      {detail && <span className="settings-row-detail">{detail}</span>}
      <svg className="settings-row-chevron" viewBox="0 0 8 14" aria-hidden="true">
        <path d="M1 1l6 6-6 6" />
      </svg>
    </Button>
  );
}
