"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { WorkspaceSummary } from "@/lib/contracts";

const WorkspaceAccessContext = createContext<WorkspaceSummary | null>(null);

export function WorkspaceAccessProvider({ workspace, children }: { workspace: WorkspaceSummary | null; children: ReactNode }) {
  return <WorkspaceAccessContext.Provider value={workspace}>{children}</WorkspaceAccessContext.Provider>;
}

export function useWorkspaceAccess() {
  const workspace = useContext(WorkspaceAccessContext);
  return { workspace, canManage: workspace?.role === "OWNER" || workspace?.role === "ADMIN", isOwner: workspace?.role === "OWNER" };
}
