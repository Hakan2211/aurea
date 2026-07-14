import type { LucideIcon } from "lucide-react";

export function Placeholder({
  icon: Icon,
  title,
  blurb,
  mockup,
}: {
  icon: LucideIcon;
  title: string;
  blurb: string;
  /** filename in UI-Design/ that specifies this screen */
  mockup: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-gold/25 text-gold">
        <Icon size={24} strokeWidth={1.5} />
      </div>
      <h1 className="font-serif text-3xl text-cream">{title}</h1>
      <p className="max-w-md text-[13px] leading-relaxed text-fog">{blurb}</p>
      <p className="text-[11px] text-fog/60">
        Design: <span className="text-gold/70">UI-Design/{mockup}</span>
      </p>
    </div>
  );
}
