import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";
/* eslint-disable @next/next/no-img-element -- profile images are canonical bounded data URLs returned by the account API */

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-lockup" aria-label="SnagTime">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" role="presentation">
          <rect x="5" y="6" width="22" height="20" rx="5" fill="currentColor" />
          <path d="M10 4v5M22 4v5M5 12h22" fill="none" stroke="white" strokeWidth="2.25" strokeLinecap="round" />
          <rect x="9" y="15" width="7" height="4" rx="2" fill="#93C5FD" />
          <rect x="17" y="15" width="6" height="4" rx="2" fill="white" />
          <path d="m18.5 18.5 6.5 2.7-2.6 1.1 1.8 3.2-1.9 1.1-1.8-3.2-2 2.1v-7Z" fill="#0B1F3A" stroke="white" strokeWidth=".8" strokeLinejoin="round" />
        </svg>
      </span>
      {!compact && <span className="brand-name">SnagTime</span>}
    </div>
  );
}

export function Avatar({ name, imageUrl = null, size = "md" }: { name: string; imageUrl?: string | null; size?: "sm" | "md" | "lg" }) {
  const initials = name.split(" ").map((part) => part[0]).slice(0, 2).join("");
  return imageUrl ? <span className={`avatar avatar-${size}`}><img src={imageUrl} alt={`${name} profile`} /></span> : <span className={`avatar avatar-${size}`} aria-label={name}>{initials}</span>;
}

export function Badge({ children, tone = "neutral", dot = false }: { children: ReactNode; tone?: "neutral" | "success" | "warning" | "danger" | "brand" | "info"; dot?: boolean }) {
  return <span className={`badge badge-${tone}`}>{dot && <span className="badge-dot" />}{children}</span>;
}

export function ButtonLink({ href, children, icon, variant = "primary", size = "md", className = "" }: { href: string; children: ReactNode; icon?: IconName; variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; className?: string }) {
  return <Link className={`button button-${variant} button-${size} ${className}`} href={href}>{icon && <Icon name={icon} size={16} />}{children}</Link>;
}

export function ActionButton({ children, icon, variant = "secondary", type = "button", onClick, disabled, className = "", ariaLabel }: { children?: ReactNode; icon?: IconName; variant?: "primary" | "secondary" | "ghost" | "danger"; type?: "button" | "submit"; onClick?: () => void; disabled?: boolean; className?: string; ariaLabel?: string }) {
  return <button className={`button button-${variant} ${className}`} type={type} onClick={onClick} disabled={disabled} aria-label={ariaLabel}>{icon && <Icon name={icon} size={16} />}{children}</button>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function SectionHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="section-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>;
}

export function EmptyState({ icon, title, description, action }: { icon: IconName; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={24} /></span><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange?: (checked: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? "is-on" : ""}`} onClick={() => onChange?.(!checked)} disabled={disabled}><span /></button>;
}

export function Metric({ label, value, detail, icon, tone = "brand" }: { label: string; value: string; detail: string; icon: IconName; tone?: "brand" | "green" | "amber" | "blue" }) {
  return <article className="metric-card"><div className={`metric-icon metric-${tone}`}><Icon name={icon} /></div><div className="metric-label">{label}</div><strong>{value}</strong><div className="metric-detail">{detail}</div></article>;
}

export function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: ReactNode }) {
  return <label className="field"><span className="field-label">{label}{required && <span aria-hidden="true"> *</span>}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}
