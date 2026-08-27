"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AccountSummary } from "@/lib/contracts";
import { frontendApi } from "./api-adapter";
import { Icon } from "./icons";
import { ActionButton, Badge, BrandMark } from "./ui";

export function WorkspaceOnboarding() {
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    frontendApi.getAccount().then((item) => {
      if (!active) return;
      if (item.workspace.onboardingCompleted) { window.location.replace("/dashboard"); return; }
      setAccount(item);
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load your workspace."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const complete = async () => {
    setCompleting(true); setError("");
    try { await frontendApi.completeOnboarding(); window.location.replace("/dashboard"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not confirm this workspace."); setCompleting(false); }
  };

  if (loading) return <div className="auth-page"><main className="auth-card" role="status"><BrandMark /><span className="spinner" /><p>Loading your workspace…</p></main></div>;
  if (!account) return <div className="auth-page"><main className="auth-card"><BrandMark /><div><span className="outcome-eyebrow">Workspace unavailable</span><h1>We could not continue</h1><p role="alert">{error || "Sign in to continue."}</p></div><Link className="button button-primary" href="/dashboard">Go to sign in</Link></main></div>;

  return <div className="auth-page onboarding-page"><main className="auth-card onboarding-card"><BrandMark /><div className="onboarding-success"><Icon name="check" size={24} /></div><div><span className="outcome-eyebrow">Your workspace</span><h1>Everything looks ready</h1><p>Review the details below, then open your scheduling dashboard.</p></div><dl className="onboarding-summary"><div><dt>Workspace</dt><dd>{account.workspace.name}</dd></div><div><dt>Timezone</dt><dd>{account.workspace.timeZone}</dd></div><div><dt>Your role</dt><dd><Badge tone="brand">{account.workspace.role.toLowerCase()}</Badge></dd></div><div><dt>Organizer</dt><dd>{account.user.name}<small>{account.user.email}</small></dd></div></dl><div className="onboarding-next"><strong>Next steps</strong><span>Set your availability, create a booking link, and connect the tools you use.</span></div>{error && <div className="form-error" role="alert" aria-live="assertive">{error}</div>}<ActionButton variant="primary" onClick={complete} disabled={completing}>{completing ? "Opening…" : "Open dashboard"}<Icon name="arrow-right" /></ActionButton></main></div>;
}
