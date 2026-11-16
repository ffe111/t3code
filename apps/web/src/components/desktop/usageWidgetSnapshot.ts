import {
  PROVIDER_DISPLAY_NAMES,
  type EnvironmentId,
  type UsageWidgetSnapshot,
} from "@t3tools/contracts";
import type { EnvironmentPresentationWithProviders } from "@t3tools/client-runtime/state/presentation";
import {
  collectLimitAccounts,
  collectLimitNotices,
  collectExternalUsageLinks,
  collectLimitPools,
  displayLimitWindows,
  formatResetsIn,
  paceRemainingPercent,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
import { PROVIDER_PRESENTATION } from "../usage/usageProviders";

// Theme variables do not exist in the widget, so only literal chart colors carry over.
function chartColor(driver: string): string | null {
  const color = Object.values(PROVIDER_PRESENTATION).find(
    (entry) => entry.driverKind === driver,
  )?.color;
  return color?.startsWith("#") ? color : null;
}

export function usageWidgetSnapshot(
  presentations: ReadonlyMap<EnvironmentId, EnvironmentPresentationWithProviders>,
  now: number,
): UsageWidgetSnapshot {
  return {
    groups: collectLimitPools(collectLimitAccounts(presentations), now).map((pool) => {
      const sources = [...presentations.values()].filter(
        ({ serverConfig }) =>
          serverConfig?.providers.some(
            (provider) => provider.enabled && provider.driver === pool.driver,
          ) ||
          serverConfig?.usageLimitSources?.some((source) =>
            source.accounts.some((account) => account.driver === pool.driver),
          ),
      );
      return {
        label: PROVIDER_DISPLAY_NAMES[pool.driver] ?? String(pool.driver),
        color: chartColor(pool.driver),
        accounts: pool.accounts.length,
        connected:
          sources.length > 0 && sources.every((source) => source.connection.phase === "connected"),
        windows: displayLimitWindows(pool).map((window) => {
          const reset = window.resets[0];
          const resetsIn = reset ? formatResetsIn(reset.member.window, now) : null;
          return {
            label: window.label,
            remainingPercent: window.remainingPercent,
            pace: window.pace,
            segments: window.columns.map((member) =>
              member.window
                ? {
                    remainingPercent: remainingPercent(member.window),
                    timeLeftPercent: paceRemainingPercent(member.window, now),
                  }
                : { remainingPercent: null, timeLeftPercent: null },
            ),
            resets:
              resetsIn === null
                ? null
                : `${pool.accounts.length > 1 ? "Next reset" : "Resets"} ${resetsIn}`,
          };
        }),
      };
    }),
    notices: [
      ...collectLimitNotices(presentations),
      ...collectExternalUsageLinks(presentations).map(
        (link) => `${link.label}: view usage in T3 Code.`,
      ),
    ],
  };
}
