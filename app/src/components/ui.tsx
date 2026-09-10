import type { ReactNode } from "react";

/**
 * The design system.
 *
 * Small on purpose, and opinionated about three things the previous version left to each
 * caller, which is why the interface drifted:
 *
 *   Type   Six named steps. Nothing picks its own pixel value, so a heading is a heading
 *          everywhere and hierarchy survives a page being edited a year from now.
 *   Radius Two values. Controls are 6px, surfaces are 8px, and there is no third option.
 *   Colour Greyscale by default. Green, amber and red mean state; when something here is
 *          coloured, it is saying something.
 *
 * Emphasis is built from weight, colour and space rather than size. The largest text in the
 * product is 24px, because a dense working tool does not need a 40px heading to say where it is.
 */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// --- surfaces ---------------------------------------------------------------

/**
 * A raised surface, for things that are genuinely a unit -- a job, a lead, one form.
 *
 * `flat` exists because the old version put a border around everything, and a page of nested
 * outlines reads as noise. Prefer grouping with space and a single divider; reach for a border
 * when the box is actually interactive or actually separate.
 */
export function Card({
  children,
  className,
  as: Tag = "div",
  flat = false,
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "li" | "section" | "article";
  flat?: boolean;
  interactive?: boolean;
}) {
  return (
    <Tag
      className={cx(
        "rounded-card",
        flat ? "bg-surface" : "border border-line bg-surface",
        interactive &&
          "transition-colors duration-150 hover:border-line-strong hover:bg-surface-2",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** A hairline rule. Grouping by space and one divider beats another box. */
export function Divider({ className }: { className?: string }) {
  return <hr className={cx("border-0 border-t border-line", className)} />;
}

// --- badges -----------------------------------------------------------------

type Tone = "neutral" | "accent" | "fresh" | "warn" | "danger";

const BADGE_TONE: Record<Tone, string> = {
  neutral: "bg-surface-3 text-ink-dim",
  accent: "bg-surface-3 text-ink",
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
        "inline-flex items-center rounded-[4px] px-1.5 py-px text-label font-medium uppercase",
        BADGE_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * A status dot, for where a badge would be too loud.
 *
 * Never colour alone: it always sits beside a word, because roughly one man in twelve cannot
 * separate the green from the amber.
 */
export function Dot({ tone = "neutral" }: { tone?: Tone }) {
  const bg =
    tone === "fresh"
      ? "bg-fresh"
      : tone === "warn"
        ? "bg-warn"
        : tone === "danger"
          ? "bg-danger"
          : "bg-ink-faint";
  return <span className={cx("inline-block size-1.5 shrink-0 rounded-full", bg)} aria-hidden />;
}

// --- page furniture ---------------------------------------------------------

/**
 * The top of a page.
 *
 * Title, then one line saying what the numbers mean, then actions on the right. The rule is
 * that the subtitle answers "what am I looking at and how much of it", so the eye lands on
 * the count rather than on decoration.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx("mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0">
        <h1 className="text-title font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-1.5 text-meta text-ink-dim">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * A section label.
 *
 * Small, spaced capitals in a faint grey: it names a group without competing with the content
 * inside it. Making these bigger was the fastest way the old layout lost its hierarchy.
 */
export function SectionTitle({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("mb-3 flex items-center justify-between gap-4", className)}>
      <h2 className="text-label font-semibold uppercase text-ink-faint">{children}</h2>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// --- data display -----------------------------------------------------------

/**
 * A single number worth glancing at.
 *
 * Deliberately not in a box. A row of four outlined tiles is the most recognisable generated-
 * dashboard pattern there is; separating them with space and a rule says the same thing more
 * quietly and leaves the numbers as the loudest element.
 */
export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: Tone;
  href?: string;
}) {
  const valueTone =
    tone === "fresh"
      ? "text-fresh"
      : tone === "warn"
        ? "text-warn"
        : tone === "danger"
          ? "text-danger"
          : "text-ink";

  const body = (
    <>
      <div className={cx("tnum text-display font-semibold", valueTone)}>{value}</div>
      <div className="mt-1 text-meta text-ink-dim">{label}</div>
      {hint && <div className="mt-0.5 text-label text-ink-faint">{hint}</div>}
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        className="group block rounded-control px-1 py-0.5 transition-colors duration-150 hover:bg-surface"
      >
        {body}
      </a>
    );
  }
  return <div className="px-1 py-0.5">{body}</div>;
}

// --- states -----------------------------------------------------------------

/**
 * Nothing here yet.
 *
 * One sentence of what this page is for and, wherever possible, the action that fills it.
 * An empty state that only says "no results" wastes the one moment the user is actually
 * reading the interface.
 */
export function EmptyState({
  title,
  body,
  hint,
  action,
}: {
  title: string;
  body?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-card border border-dashed border-line px-6 py-12 text-center">
      <p className="text-section font-medium text-ink">{title}</p>
      {body && <p className="mx-auto mt-2 max-w-sm text-body text-ink-dim">{body}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
      {hint && <div className="mt-4 text-meta text-ink-faint">{hint}</div>}
    </div>
  );
}

/** A placeholder with the shape of the thing that is coming, so the page does not jump. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-control bg-surface-2", className)} />;
}

// --- controls ---------------------------------------------------------------

type Variant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_VARIANT: Record<Variant, string> = {
  // Brightest thing on the screen. That is what makes it primary -- not a hue.
  primary: "bg-accent text-canvas hover:bg-accent-strong active:bg-accent",
  secondary:
    "border border-line bg-surface-2 text-ink-dim hover:border-line-strong hover:text-ink active:bg-surface-3",
  ghost: "text-ink-dim hover:bg-surface-2 hover:text-ink",
  danger: "border border-danger/30 bg-danger-soft text-danger hover:border-danger/60",
};

export function Button({
  children,
  variant = "secondary",
  size = "md",
  type = "button",
  className,
  ...rest
}: {
  children: ReactNode;
  variant?: Variant;
  size?: "sm" | "md";
  type?: "button" | "submit";
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-control font-medium",
        "transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25",
        size === "sm" ? "px-2 py-1 text-meta" : "px-3 py-1.5 text-body",
        BUTTON_VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * One string for every text input, select and textarea.
 *
 * Focus is a ring rather than a colour change: it survives a palette edit, and it is visible
 * against every surface in the product.
 */
export const inputStyles =
  "w-full rounded-control border border-line bg-surface-2 px-2.5 py-1.5 text-body text-ink " +
  "placeholder:text-ink-faint outline-none transition-colors duration-150 " +
  "hover:border-line-strong focus:border-line-strong focus:ring-2 focus:ring-ink/15";

/** Selects need their own arrow once the native one is styled away. */
export const selectStyles = cx(
  inputStyles,
  "cursor-pointer appearance-none bg-[length:12px] bg-[right_0.5rem_center] bg-no-repeat pr-7",
  "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 12 12%22 fill=%22none%22 stroke=%22%239aa0a8%22 stroke-width=%221.5%22><path d=%22M3 4.5 6 7.5 9 4.5%22/></svg>')]",
);

/**
 * A filter chip.
 *
 * Rectangular with a small radius rather than a pill: pills read as tags you can remove, and
 * these toggle. The shape should say which it is before the label is read.
 */
export function Chip({
  active,
  children,
  className,
}: {
  active?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-control border px-2.5 py-1 text-meta transition-colors duration-150",
        active
          ? "border-line-strong bg-surface-3 text-ink"
          : "border-line bg-transparent text-ink-dim hover:border-line-strong hover:text-ink",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * A hover label, built on the title attribute.
 *
 * Deliberately not a floating component: the native one is keyboard and screen-reader
 * accessible for free, and a bespoke tooltip is a lot of machinery for a hint.
 */
export function Hint({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span title={label} className={cx("cursor-help", className)}>
      {children}
    </span>
  );
}
