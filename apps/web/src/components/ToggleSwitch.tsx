'use client';

export function ToggleSwitch({
  id,
  checked,
  onChange,
  label,
  description,
  disabled,
  compact,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <label
      className={`toggle-switch${compact ? ' toggle-switch-compact' : ''}${disabled ? ' is-disabled' : ''}`}
      htmlFor={id}
    >
      <span className="toggle-switch-text">
        <span className="toggle-switch-label">{label}</span>
        {description ? (
          <span className="toggle-switch-description">{description}</span>
        ) : null}
      </span>
      <span className="toggle-switch-control">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="toggle-switch-track" aria-hidden />
      </span>
    </label>
  );
}
