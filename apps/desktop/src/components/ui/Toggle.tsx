import { cx } from "./cx";

/* The one switch. Previously copied in MusicLab and SettingsScreen. */
export function Toggle({
  on,
  onChange,
  disabled,
  title,
}: {
  on: boolean;
  onChange: () => void;
  disabled?: boolean;
  /** why it's disabled, or what it does — hover text */
  title?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={onChange}
      disabled={disabled}
      title={title}
      className={cx(
        "relative h-5 w-9 shrink-0 rounded-pill transition duration-[var(--dur-fast)]",
        on ? "bg-gradient-to-b from-gold to-gold-deep" : "bg-cream/12",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      <span
        className={cx(
          "absolute top-0.5 h-4 w-4 rounded-full transition-all duration-[var(--dur-fast)]",
          on ? "left-[18px] bg-ink" : "left-0.5 bg-cream/70",
        )}
      />
    </button>
  );
}
