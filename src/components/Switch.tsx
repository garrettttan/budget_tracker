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
