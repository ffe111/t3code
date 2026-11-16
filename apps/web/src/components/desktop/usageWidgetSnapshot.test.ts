import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { usageWidgetSnapshot } from "./usageWidgetSnapshot";

const checkedAt = "2026-11-16T12:00:00.000Z";
const now = Date.parse(checkedAt);

function provider(instanceId: string, sessionUsed: number, weeklyUsed: number): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    usageLimits: {
      checkedAt,
      windows: [
        {
          id: "primary",
          kind: "session",
          label: "Session",
          usedPercent: sessionUsed,
          windowDurationMins: 300,
          resetsAt: "2026-11-16T14:00:00.000Z",
        },
        {
          id: "secondary",
          kind: "weekly",
          label: "Weekly",
          usedPercent: weeklyUsed,
          windowDurationMins: 7 * 24 * 60,
          resetsAt: "2026-11-19T12:00:00.000Z",
        },
      ],
    },
  };
}

function presentations(phase: "connected" | "offline") {
  return new Map([
    [
      EnvironmentId.make("desk"),
      {
        entry: { target: { label: "Desk" } },
        connection: { phase, error: null, traceId: null },
        serverConfig: {
          providers: [provider("codex-work", 20, 40), provider("codex-home", 60, 80)],
        },
      },
    ],
  ]) as unknown as Parameters<typeof usageWidgetSnapshot>[0];
}

describe("usageWidgetSnapshot", () => {
  it("uses the shared pooled percentages, one bar segment per account (lowest first) and the even-pace line", () => {
    const [group] = usageWidgetSnapshot(presentations("connected"), now).groups;
    expect(group).toMatchObject({ label: "Codex", accounts: 2, connected: true });
    const [session, weekly] = group!.windows;
    expect(session).toMatchObject({ label: "Session", remainingPercent: 60 });
    expect(session?.resets).toContain("Next reset");
    // Session: 2h left of 5h would be 40%; weekly: 3d left of 7d would be 43%.
    expect(session?.segments).toEqual([
      { remainingPercent: 40, timeLeftPercent: 40 },
      { remainingPercent: 80, timeLeftPercent: 40 },
    ]);
    expect(weekly?.remainingPercent).toBe(40);
  });

  it("carries a provider's literal chart color and leaves theme colors to the widget", () => {
    const claude = new Map([
      [
        EnvironmentId.make("desk"),
        {
          entry: { target: { label: "Desk" } },
          connection: { phase: "connected", error: null, traceId: null },
          serverConfig: {
            providers: [
              { ...provider("claude", 10, 10), driver: ProviderDriverKind.make("claudeAgent") },
            ],
          },
        },
      ],
    ]) as unknown as Parameters<typeof usageWidgetSnapshot>[0];
    expect(usageWidgetSnapshot(claude, now).groups[0]?.color).toBe("#d97757");
    expect(usageWidgetSnapshot(presentations("connected"), now).groups[0]?.color).toBeNull();
  });

  it("marks cached provider readings as offline after its environment disconnects", () => {
    expect(usageWidgetSnapshot(presentations("offline"), now).groups[0]?.connected).toBe(false);
  });
});
