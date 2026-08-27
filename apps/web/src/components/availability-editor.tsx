"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AvailabilityOverride } from "@/lib/contracts";
import type { AvailabilityDay, AvailabilityWindow } from "./demo-data";
import { frontendApi } from "./api-adapter";
import { availabilitySaveResultIsCurrent, canMutateAvailability, type AvailabilityLoadState } from "./availability-editor-state";
import { Icon } from "./icons";
import { ActionButton, Badge, Field, PageHeader, SectionHeader, Toggle } from "./ui";
import { useWorkspaceAccess } from "./workspace-access";

const clockValue = (minutes: number | null | undefined, fallback: number) => { const value = minutes ?? fallback; return `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`; };
const clockMinutes = (value: string) => { const [hours = 0, minutes = 0] = value.split(":").map(Number); return hours * 60 + minutes; };

export function AvailabilityEditor() {
  const { canManage } = useWorkspaceAccess();
  const [days, setDays] = useState<AvailabilityDay[]>([]);
  const [timeZone, setTimeZone] = useState("America/Chicago");
  const [overrides, setOverrides] = useState<AvailabilityOverride[]>([]);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loadState, setLoadState] = useState<AvailabilityLoadState>("loading");
  const [error, setError] = useState("");
  const editRevision = useRef(0);
  const loadRevision = useRef(0);

  const markEdited = () => { editRevision.current += 1; setDirty(true); setSaved(false); };
  const patchDay = (index: number, patch: Partial<AvailabilityDay>) => { markEdited(); setDays((items) => items.map((day, i) => i === index ? { ...day, ...patch } : day)); };
  const patchWindow = (dayIndex: number, windowIndex: number, patch: Partial<AvailabilityWindow>) => { markEdited(); setDays((items) => items.map((day, index) => index === dayIndex ? { ...day, windows: day.windows.map((window, i) => i === windowIndex ? { ...window, ...patch } : window) } : day)); };
  const patchOverrides = (update: (items: AvailabilityOverride[]) => AvailabilityOverride[]) => { markEdited(); setOverrides(update); };
  const patchTimeZone = (value: string) => { markEdited(); setTimeZone(value); };
  const loadAvailability = useCallback(() => {
    const requestRevision = ++loadRevision.current;
    return frontendApi.getAvailability().then((schedule) => {
      if (loadRevision.current !== requestRevision) return;
      setDays(schedule.days); setTimeZone(schedule.timeZone); setOverrides(schedule.overrides);
      editRevision.current = 0; setDirty(false); setLoadState("loaded");
    }).catch((reason) => {
      if (loadRevision.current !== requestRevision) return;
      setError(reason instanceof Error ? reason.message : "Could not load availability."); setLoadState("error");
    });
  }, []);
  useEffect(() => { void loadAvailability(); return () => { loadRevision.current += 1; }; }, [loadAvailability]);
  const retryLoad = () => { setLoadState("loading"); setError(""); setSaved(false); void loadAvailability(); };
  const save = async () => {
    if (!canMutateAvailability(loadState) || !dirty || saving || conflictingDates.size > 0) return;
    const submittedRevision = editRevision.current;
    const submittedDays = days; const submittedTimeZone = timeZone; const submittedOverrides = overrides;
    setSaving(true); setError("");
    try {
      const schedule = await frontendApi.saveAvailability(submittedDays, submittedTimeZone, submittedOverrides);
      if (availabilitySaveResultIsCurrent(submittedRevision, editRevision.current)) {
        setDays(schedule.days); setTimeZone(schedule.timeZone); setOverrides(schedule.overrides); setDirty(false); setSaved(true);
        window.setTimeout(() => setSaved(false), 2400);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save availability."); }
    finally { setSaving(false); }
  };
  const nextDate = () => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const date = new Date(Date.UTC(value("year"), value("month") - 1, value("day")));
    date.setUTCDate(date.getUTCDate() + 7);
    return date.toISOString().slice(0, 10);
  };
  const dateCounts = overrides.reduce((counts, item) => counts.set(item.dateKey, (counts.get(item.dateKey) ?? 0) + 1), new Map<string, number>());
  const conflictingDates = new Set([...dateCounts].filter(([, count]) => count > 1).map(([date]) => date));
  const nextUnusedDate = () => { const date = new Date(`${nextDate()}T12:00:00Z`); while (overrides.some((item) => item.dateKey === date.toISOString().slice(0, 10))) date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); };

  if (!canManage) return <div className="page-stack"><PageHeader title="Availability" /><section className="panel error-state" role="alert"><span><Icon name="x" /></span><h2>Organizer access required</h2><p>Your workspace role cannot change availability.</p></section></div>;
  if (loadState === "loading") return <div className="page-stack"><PageHeader eyebrow="Schedule · Working hours" title="Availability" description="Define when people can book you. Event rules and calendar conflicts are applied on top." /><div className="sync-note" role="status"><span className="spinner" />Loading availability…</div></div>;
  if (loadState === "error") return <div className="page-stack"><PageHeader eyebrow="Schedule · Working hours" title="Availability" description="Define when people can book you. Event rules and calendar conflicts are applied on top." /><section className="panel error-state" role="alert"><span><Icon name="x" /></span><h2>Availability did not load</h2><p>{error || "Could not load availability."}</p><ActionButton variant="primary" onClick={retryLoad}>Retry</ActionButton></section></div>;

  return <div className="page-stack">
    <PageHeader eyebrow="Schedule · Working hours" title="Availability" description="Define when people can book you. Event rules and calendar conflicts are applied on top." actions={<ActionButton variant="primary" onClick={save} disabled={saving || !dirty || conflictingDates.size > 0}><Icon name="check" size={16} />{saving ? "Saving…" : dirty ? "Save changes" : "Saved"}</ActionButton>} />
    {saved && <div className="toast" role="status"><span><Icon name="check" /></span>Availability saved</div>}
    {error && <div className="toast toast-error" role="alert"><span><Icon name="x" /></span>{error}</div>}
    {conflictingDates.size > 0 && <div className="toast toast-error" role="alert"><span><Icon name="x" /></span>Use each date only once. Remove or change the highlighted duplicate date before saving.</div>}
    <div className="availability-layout">
      <section className="panel availability-main">
        <SectionHeader title="Weekly hours" description="Your reusable default schedule" action={<div className="timezone-pill"><Icon name="globe" size={15} />{timeZone}</div>} />
        <div className="schedule-list">
          {days.map((day, dayIndex) => <div className={`schedule-day ${!day.enabled ? "is-off" : ""}`} key={day.day}>
            <div className="day-toggle"><Toggle checked={day.enabled} onChange={(enabled) => patchDay(dayIndex, { enabled, windows: enabled && day.windows.length === 0 ? [{ id: crypto.randomUUID(), start: "9:00 AM", end: "5:00 PM" }] : day.windows })} label={`${day.day} availability`} /><strong>{day.short}</strong></div>
            <div className="day-windows">{day.enabled ? day.windows.map((window, windowIndex) => <div className="time-window" role="group" aria-label={`${day.day} time window ${windowIndex + 1}`} key={window.id}><select aria-label={`Start time for ${day.day} window ${windowIndex + 1}`} value={window.start} onChange={(e) => patchWindow(dayIndex, windowIndex, { start: e.target.value })}>{["8:00 AM", "9:00 AM", "10:00 AM", "11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM"].map((time) => <option key={time}>{time}</option>)}</select><span aria-hidden="true">–</span><select aria-label={`End time for ${day.day} window ${windowIndex + 1}`} value={window.end} onChange={(e) => patchWindow(dayIndex, windowIndex, { end: e.target.value })}>{["12:00 PM", "1:00 PM", "3:00 PM", "4:00 PM", "5:00 PM", "6:00 PM"].map((time) => <option key={time}>{time}</option>)}</select><button type="button" className="icon-button" aria-label={`Remove ${day.day} time window`} onClick={() => patchDay(dayIndex, { windows: day.windows.filter((_, i) => i !== windowIndex) })}><Icon name="trash" size={16} /></button></div>) : <span className="unavailable-label">Unavailable</span>}</div>
            <button type="button" className="icon-button add-window" aria-label={`Add ${day.day} time window`} disabled={!day.enabled} onClick={() => patchDay(dayIndex, { windows: [...day.windows, { id: crypto.randomUUID(), start: "1:00 PM", end: "5:00 PM" }] })}><Icon name="plus" /></button>
          </div>)}
        </div>
      </section>
      <aside className="availability-aside">
        <section className="panel compact-panel"><SectionHeader title="Calendar preview" /><div className="mini-week"><div className="mini-week-head">{days.map((day) => <span key={day.short}>{day.short[0]}</span>)}</div><div className="mini-week-grid">{days.map((day) => <div key={day.short} className={day.enabled ? "has-hours" : ""}>{day.enabled && <span style={{ height: `${Math.max(28, day.windows.length * 24)}px` }} />}</div>)}</div></div><p className="aside-note"><span className="legend-dot" />Your bookable hours before event rules and connected calendar conflicts.</p></section>
        <section className="panel compact-panel"><SectionHeader title="Schedule rules" /><Field label="Timezone"><select value={timeZone} onChange={(event) => patchTimeZone(event.target.value)}>{[...new Set([timeZone, "America/Chicago", "America/New_York", "America/Los_Angeles", "Europe/London", "UTC"])].map((zone) => <option value={zone} key={zone}>{zone}</option>)}</select></Field><p className="aside-note">Invitees choose their own display timezone on the public booking page.</p></section>
      </aside>
    </div>
    <div className="two-panel-grid">
      <section className="panel"><SectionHeader title="Date overrides" description="Use different hours on a specific date" action={<ActionButton icon="plus" variant="secondary" onClick={() => patchOverrides((items) => [...items, { dateKey: nextUnusedDate(), isAvailable: true, startMinute: 540, endMinute: 1020 }])}>Add override</ActionButton>} /><div className="exception-list">{overrides.filter((item) => item.isAvailable).map((item, index) => <div className={`exception-row ${conflictingDates.has(item.dateKey) ? "has-conflict" : ""}`} key={item.id ?? `${item.dateKey}-${index}`}><span className="exception-icon"><Icon name="calendar" /></span><div><input type="date" value={item.dateKey} onChange={(event) => patchOverrides((items) => items.map((current) => current === item ? { ...current, dateKey: event.target.value } : current))} aria-label="Override date" aria-invalid={conflictingDates.has(item.dateKey)} /><span><input type="time" value={clockValue(item.startMinute, 540)} onChange={(event) => patchOverrides((items) => items.map((current) => current === item ? { ...current, startMinute: clockMinutes(event.target.value) } : current))} aria-label={`Start time for ${item.dateKey}`} /> – <input type="time" value={clockValue(item.endMinute, 1020)} onChange={(event) => patchOverrides((items) => items.map((current) => current === item ? { ...current, endMinute: clockMinutes(event.target.value) } : current))} aria-label={`End time for ${item.dateKey}`} /></span>{conflictingDates.has(item.dateKey) && <small role="alert">This date is already used.</small>}</div><Badge tone="info">Available</Badge><button className="icon-button" onClick={() => patchOverrides((items) => items.filter((current) => current !== item))} aria-label={`Remove override for ${item.dateKey}`}><Icon name="trash" /></button></div>)}</div>{!overrides.some((item) => item.isAvailable) && <div className="empty-state"><p>No date overrides configured.</p></div>}</section>
      <section className="panel"><SectionHeader title="Time off" description="Block a full date" action={<ActionButton icon="plus" variant="secondary" onClick={() => patchOverrides((items) => [...items, { dateKey: nextUnusedDate(), isAvailable: false, startMinute: null, endMinute: null }])}>Add time off</ActionButton>} /><div className="exception-list">{overrides.filter((item) => !item.isAvailable).map((item, index) => <div className={`exception-row ${conflictingDates.has(item.dateKey) ? "has-conflict" : ""}`} key={item.id ?? `${item.dateKey}-off-${index}`}><span className="exception-icon exception-off"><Icon name="calendar" /></span><div><input type="date" value={item.dateKey} onChange={(event) => patchOverrides((items) => items.map((current) => current === item ? { ...current, dateKey: event.target.value } : current))} aria-label="Time-off date" aria-invalid={conflictingDates.has(item.dateKey)} /><span>Unavailable all day</span>{conflictingDates.has(item.dateKey) && <small role="alert">This date is already used.</small>}</div><Badge tone="neutral">Unavailable</Badge><button className="icon-button" onClick={() => patchOverrides((items) => items.filter((current) => current !== item))} aria-label={`Remove time off for ${item.dateKey}`}><Icon name="trash" /></button></div>)}</div>{!overrides.some((item) => !item.isAvailable) && <div className="empty-state"><p>No time off configured.</p></div>}</section>
    </div>
  </div>;
}
