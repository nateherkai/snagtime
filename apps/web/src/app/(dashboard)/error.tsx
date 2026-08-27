"use client";
import { Icon } from "@/components/icons";
export default function DashboardError({ reset }: { reset: () => void }) { return <div className="error-state"><span><Icon name="x" /></span><h1>Something didn’t load</h1><p>Your data is safe. Try loading this view again.</p><button className="button button-primary" onClick={reset}>Try again</button></div>; }
