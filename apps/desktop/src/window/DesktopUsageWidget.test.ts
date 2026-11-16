import * as NodeEvents from "node:events";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as Electron from "electron";
import type { UsageWidgetSnapshot } from "@t3tools/contracts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopState from "../app/DesktopState.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import { USAGE_WIDGET_ACTION_CHANNEL } from "../ipc/channels.ts";
import * as DesktopUsageWidget from "./DesktopUsageWidget.ts";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  screen: {
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
  },
}));

function fakeWindow(id: number) {
  let destroyed = false;
  let bounds = { x: 0, y: 0, width: 300, height: 180 };
  const webContents = Object.assign(new NodeEvents.EventEmitter(), {
    id,
    mainFrame: {},
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  });
  const native = Object.assign(new NodeEvents.EventEmitter(), {
    webContents,
    isDestroyed: () => destroyed,
    getBounds: () => bounds,
    setBounds: (next: typeof bounds) => {
      bounds = next;
    },
    setVisibleOnAllWorkspaces: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setSkipTaskbar: vi.fn(),
    showInactive: vi.fn(),
    loadURL: vi.fn(() => Promise.resolve()),
    destroy: () => {
      destroyed = true;
      native.emit("closed");
    },
  });
  return { native, window: native as unknown as Electron.BrowserWindow };
}

const reading: UsageWidgetSnapshot = {
  groups: [
    {
      label: "Codex",
      color: null,
      accounts: 2,
      connected: true,
      windows: [
        {
          label: "Session",
          remainingPercent: 50,
          pace: "on",
          segments: [{ remainingPercent: 50, timeLeftPercent: 55 }],
          resets: "Resets in 2h",
        },
      ],
    },
  ],
  notices: [],
};

function withWidget<A, E, R>(
  effect: (harness: {
    widget: DesktopUsageWidget.DesktopUsageWidget["Service"];
    created: ReturnType<typeof fakeWindow>[];
    main: ReturnType<typeof fakeWindow>;
    revealed: Electron.BrowserWindow[];
    action: (
      action: string | { readonly height: number },
      trusted?: boolean,
    ) => Effect.Effect<unknown>;
  }) => Effect.Effect<A, E, R>,
  visible = false,
) {
  return Effect.gen(function* () {
    vi.clearAllMocks();
    const created: ReturnType<typeof fakeWindow>[] = [];
    const main = fakeWindow(1);
    const revealed: Electron.BrowserWindow[] = [];
    return yield* Effect.gen(function* () {
      const widget = yield* DesktopUsageWidget.DesktopUsageWidget;
      yield* widget.installActions;
      const handler = vi
        .mocked(Electron.ipcMain.handle)
        .mock.calls.find(([channel]) => channel === USAGE_WIDGET_ACTION_CHANNEL)![1];
      const action = (value: string | { readonly height: number }, trusted = true) =>
        Effect.promise(() =>
          Promise.resolve(
            handler(
              {
                sender: trusted ? created.at(-1)!.native.webContents : main.native.webContents,
                senderFrame: trusted
                  ? created.at(-1)!.native.webContents.mainFrame
                  : main.native.webContents.mainFrame,
              } as unknown as Electron.IpcMainInvokeEvent,
              value,
            ),
          ),
        );
      return yield* effect({ widget, created, main, revealed, action });
    }).pipe(
      Effect.provide(
        DesktopUsageWidget.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ElectronWindow.ElectronWindow)({
                main: Effect.succeedSome(main.window),
                create: () =>
                  Effect.sync(() => {
                    const next = fakeWindow(created.length + 2);
                    created.push(next);
                    return next.window;
                  }),
                reveal: (window) =>
                  Effect.sync(() => {
                    revealed.push(window);
                  }),
              }),
              DesktopEnvironment.layer({
                dirname: "/app",
                homeDirectory: "/widget-test",
                platform: "win32",
                processArch: "x64",
                appVersion: "0.0.0",
                appPath: "/app",
                isPackaged: false,
                resourcesPath: "/app/resources",
                runningUnderArm64Translation: false,
              }).pipe(
                Layer.provide(DesktopConfig.layerTest({})),
                Layer.provide(NodeServices.layer),
              ),
              DesktopState.layer,
              DesktopAppSettings.layerTest({
                ...DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS,
                usageWidget: { visible, layout: "vertical", position: null },
              }),
            ),
          ),
        ),
      ),
      Effect.scoped,
    );
  }).pipe(Effect.provide(NodeServices.layer));
}

describe("DesktopUsageWidget", () => {
  it.effect(
    "creates one widget, rejects other renderers, preserves a dragged position and restores main when hidden",
    () =>
      withWidget(({ widget, created, revealed, action }) =>
        Effect.gen(function* () {
          yield* widget.publish(reading);
          expect(created).toHaveLength(0);
          yield* widget.show;
          yield* widget.show;
          expect(created).toHaveLength(1);
          expect(widget.keepsMainAlive()).toBe(true);
          yield* action("ready");
          const native = created[0]!.native;
          native.setBounds({ x: 400, y: 200, width: 300, height: 200 });
          yield* action("horizontal");
          yield* widget.publish(reading);
          expect(native.getBounds()).toMatchObject({ x: 400, y: 200 });
          expect(Exit.isFailure(yield* Effect.exit(action("hide", false)))).toBe(true);
          expect(native.isDestroyed()).toBe(false);
          yield* action("hide");
          expect(widget.keepsMainAlive()).toBe(false);
          expect(revealed).toHaveLength(1);
          yield* widget.publish(reading);
          expect(created).toHaveLength(1);
        }),
      ),
  );

  it.effect(
    "restores an enabled widget and marks retained data offline on main renderer failure",
    () =>
      withWidget(
        ({ widget, created, main, action }) =>
          Effect.gen(function* () {
            yield* widget.publish(reading);
            yield* action("ready");
            expect(created).toHaveLength(1);
            main.native.webContents.emit("render-process-gone");
            expect(
              created[0]!.native.webContents.send.mock.calls.at(-1)?.[1].snapshot.groups[0]
                .connected,
            ).toBe(false);
            yield* widget.publish(reading);
            expect(
              created[0]!.native.webContents.send.mock.calls.at(-1)?.[1].snapshot.groups[0]
                .connected,
            ).toBe(true);
          }),
        true,
      ),
  );

  it.effect("fits the measured content height until the user resizes, then keeps that size", () =>
    withWidget(
      ({ widget, created, action }) =>
        Effect.gen(function* () {
          yield* widget.publish(reading);
          yield* action("ready");
          const native = created[0]!.native;
          yield* action({ height: 420 });
          expect(native.getBounds()).toMatchObject({ width: 300, height: 420 });

          native.setBounds({ x: 0, y: 0, width: 520, height: 640 });
          native.emit("resize");
          yield* TestClock.adjust(300);
          yield* action({ height: 900 });
          expect(native.getBounds()).toMatchObject({ width: 520, height: 640 });

          yield* action("fit");
          expect(native.getBounds()).toMatchObject({ width: 300, height: 900 });
          yield* action("horizontal");
          yield* widget.publish(reading);
          expect(native.getBounds()).toMatchObject({ width: 300, height: 900 });
        }),
      true,
    ),
  );

  it.effect("toggles between pinned above other windows and an ordinary taskbar window", () =>
    withWidget(
      ({ widget, created, action }) =>
        Effect.gen(function* () {
          yield* widget.publish(reading);
          yield* action("ready");
          const native = created[0]!.native;
          const sent = () => native.webContents.send.mock.calls.at(-1)?.[1].alwaysOnTop;
          expect(sent()).toBe(true);

          yield* action("toggle-top");
          expect(native.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
          expect(native.setSkipTaskbar).toHaveBeenLastCalledWith(false);
          expect(sent()).toBe(false);
          expect(widget.keepsMainAlive()).toBe(true);

          yield* action("toggle-top");
          expect(native.setAlwaysOnTop).toHaveBeenLastCalledWith(true);
          expect(native.setSkipTaskbar).toHaveBeenLastCalledWith(true);
          expect(sent()).toBe(true);
        }),
      true,
    ),
  );
});
