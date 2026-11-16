import type { UsageWidgetSnapshot, UsageWidgetPreferences } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Ref from "effect/Ref";
import * as DesktopState from "../app/DesktopState.ts";
import * as Electron from "electron";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopIpc from "../ipc/DesktopIpc.ts";
import * as Channels from "../ipc/channels.ts";
import { USAGE_WIDGET_DOCUMENT } from "./usageWidgetDocument.ts";
import { usageWidgetBounds } from "./usageWidgetBounds.ts";

export class DesktopUsageWidget extends Context.Service<
  DesktopUsageWidget,
  {
    readonly keepsMainAlive: () => boolean;
    readonly show: Effect.Effect<void, ElectronWindow.ElectronWindowCreateError>;
    readonly publish: (
      snapshot: UsageWidgetSnapshot,
    ) => Effect.Effect<void, ElectronWindow.ElectronWindowCreateError>;
    readonly installActions: Effect.Effect<
      void,
      DesktopIpc.DesktopIpcRegistrationError,
      import("effect/Scope").Scope
    >;
  }
>()("@t3tools/desktop/window/DesktopUsageWidget") {}

const AUTO_COLUMN_WIDTH = 300;
const MIN_SIZE = { width: 240, height: 140 } as const;

const make = Effect.gen(function* () {
  const windows = yield* ElectronWindow.ElectronWindow;
  const settings = yield* DesktopAppSettings.DesktopAppSettings;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const state = yield* DesktopState.DesktopState;
  const mutex = yield* Semaphore.make(1);
  let preferences: UsageWidgetPreferences | undefined;
  let widget: Electron.BrowserWindow | undefined;
  let snapshot: UsageWidgetSnapshot = { groups: [], notices: [] };
  let moveFiber: Fiber.Fiber<void> | undefined;
  let disposing = false;
  let fitHeight = 180;
  let applied = { width: 0, height: 0 };
  let sizeFiber: Fiber.Fiber<void> | undefined;
  let observedMain: Electron.BrowserWindow | undefined;
  const context = yield* Effect.context<never>();
  const runFork = Effect.runForkWith(context);
  const runSync = Effect.runSyncWith(context);
  const persist = Effect.suspend(() =>
    preferences === undefined
      ? Effect.void
      : settings.setUsageWidget(preferences).pipe(
          Effect.catch((error) =>
            Effect.logWarning("Could not save usage widget preferences.", error),
          ),
          Effect.asVoid,
        ),
  );
  const rememberPosition = () => {
    if (!widget || widget.isDestroyed() || !preferences) return;
    const { x, y } = widget.getBounds();
    preferences = { ...preferences, position: { x, y } };
  };
  const flushPosition = mutex.withPermit(
    Effect.gen(function* () {
      rememberPosition();
      yield* persist;
    }),
  );
  const initialize = Effect.gen(function* () {
    preferences ??= (yield* settings.get).usageWidget;
  });
  const send = () => {
    if (widget && !widget.isDestroyed())
      widget.webContents.send(Channels.USAGE_WIDGET_STATE_CHANNEL, {
        layout: preferences?.layout ?? "vertical",
        alwaysOnTop: preferences?.alwaysOnTop ?? true,
        snapshot,
      });
  };
  const resize = (restorePosition = false) => {
    if (!widget || widget.isDestroyed() || !preferences) return;
    const saved = preferences.size ?? null;
    const size = saved
      ? {
          width: Math.max(MIN_SIZE.width, saved.width),
          height: Math.max(MIN_SIZE.height, saved.height),
        }
      : {
          width:
            preferences.layout === "horizontal"
              ? Math.max(1, snapshot.groups.length) * AUTO_COLUMN_WIDTH
              : AUTO_COLUMN_WIDTH,
          height: Math.max(MIN_SIZE.height, fitHeight),
        };
    const position = restorePosition ? preferences.position : widget.getBounds();
    const display = position
      ? Electron.screen.getDisplayNearestPoint(position)
      : Electron.screen.getPrimaryDisplay();
    const bounds = usageWidgetBounds(position, size, display.workArea);
    applied = { width: bounds.width, height: bounds.height };
    widget.setBounds(bounds);
  };
  const ensure = Effect.gen(function* () {
    yield* initialize;
    if (!preferences!.visible || (widget && !widget.isDestroyed())) return;
    const created = yield* windows.create(
      {
        width: 300,
        height: 180,
        show: false,
        frame: false,
        resizable: true,
        minWidth: MIN_SIZE.width,
        minHeight: MIN_SIZE.height,
        alwaysOnTop: preferences!.alwaysOnTop ?? true,
        // Unpinned, it is an ordinary window with its own taskbar entry.
        skipTaskbar: preferences!.alwaysOnTop ?? true,
        title: "T3 Code: Usage limits",
        webPreferences: {
          preload: environment.path.join(
            environment.path.dirname(environment.preloadPath),
            "usage-widget-preload.cjs",
          ),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          partition: "usage-widget",
        },
      },
      { auxiliary: true },
    );
    widget = created;
    if (preferences!.alwaysOnTop ?? true) {
      created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    created.webContents.on("will-navigate", (event) => event.preventDefault());
    created.on("move", () => {
      if (moveFiber) runFork(Fiber.interrupt(moveFiber));
      moveFiber = runFork(Effect.sleep(300).pipe(Effect.andThen(flushPosition)));
    });
    created.on("resize", () => {
      if (sizeFiber) runFork(Fiber.interrupt(sizeFiber));
      sizeFiber = runFork(
        Effect.sleep(300).pipe(
          Effect.andThen(
            mutex.withPermit(
              Effect.gen(function* () {
                if (created.isDestroyed() || !preferences) return;
                const { width, height } = created.getBounds();
                // Our own setBounds also fires resize; only a different size is the user's.
                if (width === applied.width && height === applied.height) return;
                preferences = { ...preferences, size: { width, height } };
                yield* persist;
              }),
            ),
          ),
        ),
      );
    });
    created.on("closed", () => {
      if (widget !== created) return;
      widget = undefined;
      if (!disposing && !runSync(Ref.get(state.quitting)) && preferences?.visible) {
        preferences = { ...preferences, visible: false };
        runFork(revealMain.pipe(Effect.andThen(persist)));
      }
    });
    created.webContents.on("render-process-gone", () => created.destroy());
    resize(true);
    yield* Effect.promise(() =>
      created
        .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(USAGE_WIDGET_DOCUMENT)}`)
        .catch(() => {
          created.destroy();
        }),
    );
  });
  const revealMain = Effect.gen(function* () {
    const main = yield* windows.main;
    if (Option.isSome(main)) yield* windows.reveal(main.value);
  });
  const show = mutex.withPermit(
    Effect.gen(function* () {
      yield* initialize;
      preferences = { ...preferences!, visible: true };
      yield* ensure;
      yield* persist;
      if (widget && !widget.isDestroyed()) {
        send();
        widget.showInactive();
      }
    }),
  );
  const publish = Effect.fn("desktop.usageWidget.publish")((next: UsageWidgetSnapshot) =>
    mutex.withPermit(
      Effect.gen(function* () {
        snapshot = next;
        const main = yield* windows.main;
        if (Option.isSome(main) && observedMain !== main.value) {
          observedMain = main.value;
          const markOffline = () => {
            snapshot = {
              ...snapshot,
              groups: snapshot.groups.map((group) => ({ ...group, connected: false })),
            };
            send();
          };
          observedMain.webContents.on("render-process-gone", markOffline);
          observedMain.webContents.on("did-start-loading", markOffline);
        }
        yield* ensure;
        resize();
        send();
      }),
    ),
  );
  const actionIpc = DesktopIpc.make(Electron.ipcMain, (event) =>
    Effect.sync(
      () =>
        widget !== undefined &&
        !widget.isDestroyed() &&
        event.sender.id === widget.webContents.id &&
        event.senderFrame === widget.webContents.mainFrame,
    ),
  );
  const installActions = Effect.gen(function* () {
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        disposing = true;
        if (moveFiber) yield* Fiber.interrupt(moveFiber);
        if (sizeFiber) yield* Fiber.interrupt(sizeFiber);
        yield* flushPosition;
        if (widget && !widget.isDestroyed()) widget.destroy();
      }),
    );
    yield* actionIpc.handle(
      DesktopIpc.makeIpcMethod({
        channel: Channels.USAGE_WIDGET_ACTION_CHANNEL,
        payload: Schema.Union([
          Schema.Literals(["ready", "hide", "open", "fit", "toggle-top", "vertical", "horizontal"]),
          Schema.Struct({ height: Schema.Int }),
        ]),
        result: Schema.Void,
        handler: (action) =>
          mutex.withPermit(
            Effect.gen(function* () {
              if (!widget || widget.isDestroyed() || !preferences) return;
              if (typeof action === "object") {
                fitHeight = Math.max(MIN_SIZE.height, action.height);
                if (!preferences.size) resize();
                return;
              }
              if (action === "ready") {
                send();
                widget.showInactive();
                return;
              }
              if (action === "open") {
                yield* revealMain;
                return;
              }
              if (action === "toggle-top") {
                const pinned = !(preferences.alwaysOnTop ?? true);
                preferences = { ...preferences, alwaysOnTop: pinned };
                widget.setAlwaysOnTop(pinned);
                widget.setSkipTaskbar(pinned);
                widget.setVisibleOnAllWorkspaces(pinned, { visibleOnFullScreen: pinned });
                send();
                yield* persist;
                return;
              }
              if (action === "fit") {
                preferences = { ...preferences, size: null };
                rememberPosition();
                resize();
                yield* persist;
                return;
              }
              if (action === "hide") {
                // Never leave the app running with no visible way to recover it on Windows/Linux.
                yield* revealMain;
                rememberPosition();
                preferences = { ...preferences, visible: false };
                widget.destroy();
              } else {
                rememberPosition();
                preferences = { ...preferences, layout: action, size: null };
                resize();
                send();
              }
              yield* persist;
            }),
          ),
      }),
    );
  });
  return DesktopUsageWidget.of({
    keepsMainAlive: () => widget !== undefined && !widget.isDestroyed(),
    show,
    publish,
    installActions,
  });
});

export const layer = Layer.effect(DesktopUsageWidget, make);
export const layerTest = Layer.succeed(DesktopUsageWidget, {
  keepsMainAlive: () => false,
  show: Effect.void,
  publish: Effect.fn("DesktopUsageWidget.publish")(() => Effect.void),
  installActions: Effect.void,
});
