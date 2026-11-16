import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";
import { environmentPresentations } from "../../state/presentation";
import { usageWidgetSnapshot } from "./usageWidgetSnapshot";

export function UsageWidgetCoordinator() {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- forwards the existing provider snapshot to the native widget without another connection or polling loop
  useEffect(() => {
    const bridge = window.desktopBridge?.usageWidget;
    if (!bridge) return;
    void bridge.publish(usageWidgetSnapshot(presentations, Date.now())).catch(console.error);
  }, [presentations]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the native application menu
  useEffect(
    () =>
      window.desktopBridge?.onMenuAction((action) => {
        if (action === "show-usage-widget")
          void window.desktopBridge?.usageWidget?.show().catch(console.error);
      }),
    [],
  );
  return null;
}
