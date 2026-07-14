interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

/**
 * On/off switch. Forces `dir="ltr"` internally so the knob geometry is predictable
 * inside the app's RTL layout (otherwise the knob starts at the right edge and the
 * translate pushes it out of bounds). "On" = green track, knob on the left.
 */
export default function Toggle({ checked, onChange, disabled = false, className = '', ...rest }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      dir="ltr"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
        checked
          ? 'bg-green-500 border-green-500'
          : 'bg-slate-200 border-slate-300 dark:bg-slate-700 dark:border-slate-600'
      } ${className}`}
      {...rest}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-0.5' : 'translate-x-5'
        }`}
      />
    </button>
  );
}
