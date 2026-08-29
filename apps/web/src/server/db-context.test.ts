import { afterEach, describe, expect, it, vi } from "vitest";
import { currentDatabaseContext, runWithDatabaseContext, runWithWorkspaceRead } from "@/server/db-context";

describe("workspace database context", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("keeps run() context across awaits in production postgres", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_PROVIDER", "postgresql");
    let action = "";
    await runWithDatabaseContext({ mode: "workspace", workspaceId: "workspace-1", userId: "user-1", action: "workspace_read" }, async () => {
      await Promise.resolve();
      action = currentDatabaseContext()?.action || "";
    });
    expect(action).toBe("workspace_read");
    expect(currentDatabaseContext()?.action).toBeUndefined();
  });

  it("rebinds workspace read when ambient context is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_PROVIDER", "postgresql");
    let seen = "";
    await runWithWorkspaceRead("user-1", "workspace-1", async () => {
      await Promise.resolve();
      seen = [currentDatabaseContext()?.mode, currentDatabaseContext()?.workspaceId, currentDatabaseContext()?.action].join(":");
    });
    expect(seen).toBe("workspace:workspace-1:workspace_read");
  });
});
