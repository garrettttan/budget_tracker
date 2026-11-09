/**
 * An on/off switch: a native checkbox (role="switch", so screen readers say
 * on/off) styled as a sliding track, with its label on the right. Space or a
 * click on the label flips it.
 */
export default function Switch({ checked, onChange, children }: { checked: boolean; onChange: (on: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
      {children}
    </label>
  );
}

/**
 * A switch between two options, named on either side of the track: the knob
 * sits toward the one that's on, which reads darker. Clicking either name picks
 * it; the checkbox inside (role="switch", named by `label`) is on for `right`.
 */
export function TwoWaySwitch({
  left,
  right,
  label,
  checked,
  onChange,
}: {
  left: string;
  right: string;
  /** what "on" means, for screen readers (e.g. "Show by group") */
  label: string;
  /** true = `right` */
  checked: boolean;
  onChange: (right: boolean) => void;
}) {
  return (
    <div className="switch two-way">
      <span className={checked ? undefined : 'on'} aria-hidden="true" onClick={() => onChange(false)}>
        {left}
      </span>
      <label>
        <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="switch-track" aria-hidden="true" />
      </label>
      <span className={checked ? 'on' : undefined} aria-hidden="true" onClick={() => onChange(true)}>
        {right}
      </span>
    </div>
  );
}
