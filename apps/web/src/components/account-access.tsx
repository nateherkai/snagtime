"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { SnagTimeApiError } from "@/lib/api-client";
import { frontendApi } from "./api-adapter";
import { claimOneUseLinkAuthority, shareOneUseAction } from "./one-use-link-authority";
import { BrandMark } from "./ui";

const strongPassword = (value: string) => value.length >= 12 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);

function AccessFrame({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: ReactNode }) {
  return <div className="auth-page"><main className="auth-card recovery-card"><BrandMark /><div><span className="outcome-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{children}</main></div>;
}

function GenericRequestForm({ kind }: { kind: "password" | "verification" }) {
  const [email, setEmail] = useState("");
  const [working, setWorking] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setWorking(true); setError("");
    try {
      if (kind === "password") await frontendApi.requestPasswordReset(email.trim());
      else await frontendApi.requestEmailVerification(email.trim());
      setAccepted(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The request could not be accepted."); }
    finally { setWorking(false); }
  };
  if (accepted) return <div className="recovery-result" role="status" aria-live="polite"><strong>Request accepted</strong><p>If the address is eligible, SnagTime will make instructions available through its configured email provider. This page does not confirm an account or delivery.</p><Link className="button button-primary" href="/dashboard">Return to sign in</Link></div>;
  return <form onSubmit={submit}><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>{error && <div className="form-error" role="alert" aria-live="assertive">{error}</div>}<button className="button button-primary" type="submit" disabled={working || !email.includes("@")}>{working ? "Submitting…" : kind === "password" ? "Request reset instructions" : "Request verification instructions"}</button></form>;
}

export function ForgotPasswordView() {
  return <AccessFrame eyebrow="Account recovery" title="Reset your password" description="Submit your email address. The response is identical whether or not an eligible account exists."><GenericRequestForm kind="password" /><p className="auth-switch"><Link href="/dashboard">Back to sign in</Link></p></AccessFrame>;
}

export function ResetPasswordView() {
  const [authority, setAuthority] = useState("");
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [reset, setReset] = useState(false);
  const [error, setError] = useState("");
  const started = useRef(false);
  useEffect(() => {
    const claim = () => {
      const claimed = claimOneUseLinkAuthority("token");
      setAuthority(claimed);
      setError(claimed ? "" : "This password reset link is incomplete.");
      setPassword(""); setReset(false); setReady(true);
    };
    if (!started.current) { started.current = true; claim(); }
    window.addEventListener("hashchange", claim);
    return () => window.removeEventListener("hashchange", claim);
  }, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!authority || !strongPassword(password)) { setError("Use a complete reset link and a password that meets every requirement."); return; }
    setWorking(true); setError("");
    try { await shareOneUseAction("password-reset", authority, () => frontendApi.resetPassword(authority, password)); setPassword(""); setReset(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "This link is invalid or expired."); }
    finally { setWorking(false); }
  };
  if (!ready) return <AccessFrame eyebrow="Account recovery" title="Preparing password reset" description="Removing the one-time authority from the browser address."><div className="sync-note" role="status"><span className="spinner" />Preparing…</div></AccessFrame>;
  if (reset) return <AccessFrame eyebrow="Password reset" title="Password updated" description="Your password was reset and previous sessions were revoked. Sign in again with the new password."><Link className="button button-primary" href="/dashboard">Sign in</Link></AccessFrame>;
  return <AccessFrame eyebrow="Account recovery" title="Choose a new password" description="The one-time authority was removed from the browser address before this form was shown."><form onSubmit={submit}><label>New password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={200} aria-describedby="reset-password-rules" required /></label><p className="password-rules" id="reset-password-rules">Use at least 12 characters with uppercase, lowercase, a number, and a symbol.</p>{error && <div className="form-error" role="alert" aria-live="assertive">{error}</div>}<button className="button button-primary" type="submit" disabled={working || !authority || !strongPassword(password)}>{working ? "Resetting…" : "Reset password"}</button></form><p className="auth-switch"><Link href="/forgot-password">Request another link</Link></p></AccessFrame>;
}

export function VerifyEmailView() {
  const started = useRef(false);
  const [status, setStatus] = useState<"booting" | "idle" | "working" | "verified" | "error">("booting");
  const [error, setError] = useState("");
  useEffect(() => {
    const verify = () => {
      const authority = claimOneUseLinkAuthority("token");
      if (!authority) { queueMicrotask(() => setStatus("idle")); return; }
      queueMicrotask(() => { setError(""); setStatus("working"); });
      void shareOneUseAction("email-verification", authority, () => frontendApi.verifyEmail(authority)).then(() => setStatus("verified")).catch((reason) => { setError(reason instanceof Error ? reason.message : "This link is invalid or expired."); setStatus("error"); });
    };
    if (!started.current) { started.current = true; verify(); }
    window.addEventListener("hashchange", verify);
    return () => window.removeEventListener("hashchange", verify);
  }, []);
  if (status === "booting" || status === "working") return <AccessFrame eyebrow="Email verification" title="Verifying your email" description="The one-time authority is removed from the browser address before verification begins."><div className="sync-note" role="status"><span className="spinner" />Verifying…</div></AccessFrame>;
  if (status === "idle") return <AccessFrame eyebrow="Email verification" title="Request verification instructions" description="Submit your address. The response does not disclose whether an account exists or requires verification."><GenericRequestForm kind="verification" /><p className="auth-switch"><Link href="/dashboard">Back to sign in</Link></p></AccessFrame>;
  if (status === "verified") return <AccessFrame eyebrow="Email verified" title="Your email is verified" description="You can now sign in to the workspace created for this address."><Link className="button button-primary" href="/dashboard">Sign in</Link></AccessFrame>;
  return <AccessFrame eyebrow="Unable to verify" title="This link cannot be used" description="Verification links are one-time and expire."><div className="form-error" role="alert">{error}</div><Link className="button button-secondary" href="/verify-email">Request another link</Link></AccessFrame>;
}

export function AcceptInvitationView() {
  const authority = useRef("");
  const [status, setStatus] = useState<"working" | "login" | "accepted" | "error">("working");
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const started = useRef(false);
  const accept = useCallback(async () => {
    if (!authority.current) return;
    setStatus("working"); setError("");
    try { await shareOneUseAction("workspace-invitation", authority.current, () => frontendApi.acceptWorkspaceInvitation(authority.current)); setStatus("accepted"); }
    catch (reason) {
      if (reason instanceof SnagTimeApiError && reason.status === 401) { setStatus("login"); return; }
      setError(reason instanceof Error ? reason.message : "This invitation is invalid or expired."); setStatus("error");
    }
  }, []);
  useEffect(() => {
    const claim = () => {
      authority.current = claimOneUseLinkAuthority("token");
      if (!authority.current) { setError("This invitation link is incomplete."); setStatus("error"); return; }
      void accept();
    };
    if (!started.current) { started.current = true; claim(); }
    window.addEventListener("hashchange", claim);
    return () => window.removeEventListener("hashchange", claim);
  }, [accept]);
  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError("");
    try { await frontendApi.login(email, password); setPassword(""); await accept(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Sign in failed."); setStatus("login"); }
  };
  if (status === "working") return <AccessFrame eyebrow="Workspace invitation" title="Checking your invitation" description="The one-time authority has been removed from the browser address."><div className="sync-note" role="status"><span className="spinner" />Checking…</div></AccessFrame>;
  if (status === "accepted") return <AccessFrame eyebrow="Invitation accepted" title="You’re in" description="This workspace is now available from your account."><Link className="button button-primary" href="/dashboard">Open SnagTime</Link></AccessFrame>;
  if (status === "login") return <AccessFrame eyebrow="Workspace invitation" title="Sign in to continue" description="Use the verified account matching the invitation. The authority remains only in this page’s memory."><form onSubmit={login}><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>{error && <div className="form-error" role="alert">{error}</div>}<button className="button button-primary" type="submit">Sign in and accept</button></form></AccessFrame>;
  return <AccessFrame eyebrow="Unable to accept" title="This invitation cannot be used" description="Invitation links are bound to a verified account, single-use, and expire."><div className="form-error" role="alert">{error}</div><Link className="button button-secondary" href="/dashboard">Go to sign in</Link></AccessFrame>;
}
