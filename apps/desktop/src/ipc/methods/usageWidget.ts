import { UsageWidgetSnapshot } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as Channels from "../channels.ts";
import * as DesktopUsageWidget from "../../window/DesktopUsageWidget.ts";

export const showUsageWidget = DesktopIpc.makeIpcMethod({
  channel: Channels.USAGE_WIDGET_SHOW_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.usageWidget.show")(function* () {
    yield* (yield* DesktopUsageWidget.DesktopUsageWidget).show;
  }),
});
export const publishUsageWidget = DesktopIpc.makeIpcMethod({
  channel: Channels.USAGE_WIDGET_PUBLISH_CHANNEL,
  payload: UsageWidgetSnapshot,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.usageWidget.publish")(function* (snapshot) {
    yield* (yield* DesktopUsageWidget.DesktopUsageWidget).publish(snapshot);
  }),
});
export const installUsageWidgetActions = Effect.fn("desktop.ipc.usageWidget.installActions")(
  function* () {
    yield* (yield* DesktopUsageWidget.DesktopUsageWidget).installActions;
  },
);
