import type { ReactNode } from "react";

/** Small, shared primitives. Kept deliberately few -- a design system of five well-used pieces
 *  beats twenty that each appear once. */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------

export function Card({
  children,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "li" | "section";
}) {
  return (
    <Tag
      className={cx(
        "rounded-card border border-line bg-surface",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

// ---------------------------------------------------------------------------

export type Tone = "neutral" | "accent" | "fresh" | "warn" | "danger";

export const TONE: Record<Tone, string> = {
  neutral: "bg-surface-3 text-ink-dim",
  accent: "bg-accent-soft text-accent-ink",
  fresh: "bg-fresh-soft text-fresh",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-4",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-dim">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: Tone;
}) {
  const valueTone =
    tone === "fresh" ? "text-fresh" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <Card className="px-4 py-3.5">
      <div className={cx("tnum text-2xl font-semibold tracking-tight", valueTone)}>
        {value}
      </div>
      <div className="mt-1 text-[13px] font-medium text-ink-dim">{label}</div>
      {hint && <div className="mt-0.5 text-[11px] text-ink-faint">{hint}</div>}
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function EmptyState({
  title,
  body,
  hint,
}: {
  title: string;
  body?: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <Card className="border-dashed px-8 py-12 text-center">
      <p className="text-[15px] font-medium text-ink">{title}</p>
      {body && <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-dim">{body}</p>}
      {hint && <div className="mt-4 text-xs text-ink-faint">{hint}</div>}
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
        {children}
      </h2>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Button({
  children,
  variant = "secondary",
  type = "button",
  className,
  ...rest
}: {
  children: ReactNode;
  variant?: "primary" | "secondary";
  type?: "button" | "submit";
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition",
        variant === "primary"
          ? "bg-accent text-canvas hover:brightness-110"
          : "border border-line bg-surface-2 text-ink-dim hover:border-line-strong hover:text-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export const inputStyles =
  "w-full rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink " +
  "placeholder:text-ink-faint outline-none transition focus:border-accent";
