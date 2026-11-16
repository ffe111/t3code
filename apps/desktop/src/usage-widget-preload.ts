import { ipcRenderer } from "electron";
import type { UsageWidgetLayout, UsageWidgetSnapshot } from "@t3tools/contracts";
import { USAGE_WIDGET_ACTION_CHANNEL, USAGE_WIDGET_STATE_CHANNEL } from "./ipc/channels.ts";

const BASE_FONT_PX = 13;
// The width one provider column is designed for at the base font size.
const COLUMN_WIDTH_PX = 300;
const PACE_LABEL = { ahead: "Ahead of pace", on: "On pace", under: "Under pace" } as const;

window.addEventListener(
  "DOMContentLoaded",
  () => {
    const byId = (id: string) => document.getElementById(id)!;
    const groups = byId("groups");
    const empty = byId("empty");
    const legend = byId("legend");
    const notices = byId("notices");
    const layoutButton = byId("layout");
    const pinButton = byId("pin");
    let layout: UsageWidgetLayout = "vertical";
    let columns = 1;
    let reportedHeight = 0;
    const act = (action: string | { readonly height: number }) =>
      void ipcRenderer.invoke(USAGE_WIDGET_ACTION_CHANNEL, action);

    // Content height at the current scale; the main process only applies it until the user resizes.
    const reportFit = () => {
      const height = Math.ceil(byId("drag").offsetHeight + byId("content").offsetHeight);
      if (height !== reportedHeight) {
        reportedHeight = height;
        act({ height });
      }
    };
    const rescale = () => {
      const scale = Math.max(0.8, Math.min(2.2, window.innerWidth / (columns * COLUMN_WIDTH_PX)));
      const fontSize = `${(BASE_FONT_PX * scale).toFixed(2)}px`;
      if (document.documentElement.style.fontSize === fontSize) return;
      document.documentElement.style.fontSize = fontSize;
      reportFit();
    };
    window.addEventListener("resize", rescale);

    pinButton.addEventListener("click", () => act("toggle-top"));
    byId("open").addEventListener("click", () => act("open"));
    byId("hide").addEventListener("click", () => act("hide"));
    layoutButton.addEventListener("click", () =>
      act(layout === "vertical" ? "horizontal" : "vertical"),
    );
    byId("drag").addEventListener("dblclick", (event) => {
      if (!(event.target as Element).closest("button")) act("fit");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") act("hide");
    });

    const make = (tag: string, className?: string, value?: string) => {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (value !== undefined) element.textContent = value;
      return element;
    };

    const renderWindow = (
      group: UsageWidgetSnapshot["groups"][number],
      window: UsageWidgetSnapshot["groups"][number]["windows"][number],
    ) => {
      const row = make("div", "window");
      const head = make("div", "head");
      const pct = make("div", "pct", `${window.remainingPercent}%`);
      pct.dataset.low = String(window.remainingPercent <= 20);
      pct.append(make("small", undefined, "left"));
      head.append(make("div", "name", window.label), pct);

      const bar = make("div", "bar");
      bar.setAttribute("role", "meter");
      bar.setAttribute("aria-label", `${group.label} ${window.label} remaining`);
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.setAttribute("aria-valuenow", String(window.remainingPercent));
      bar.setAttribute(
        "aria-valuetext",
        `${window.remainingPercent}% left${window.pace ? `, ${PACE_LABEL[window.pace]}` : ""}`,
      );
      let hasLine = false;
      for (const segment of window.segments) {
        const seg = make("div", "seg");
        if (segment.remainingPercent === null) {
          seg.dataset.empty = "true";
        } else {
          const fill = make("div", "fill");
          fill.style.width = `${Math.max(0, Math.min(100, segment.remainingPercent))}%`;
          seg.append(fill);
          if (segment.timeLeftPercent !== null) {
            const line = make("div", "line");
            line.style.left = `${Math.max(2, Math.min(98, segment.timeLeftPercent))}%`;
            seg.append(line);
            hasLine = true;
          }
        }
        bar.append(seg);
      }
      if (hasLine) bar.title = "Line: where even spending would be";

      const foot = make("div", "foot", undefined);
      foot.append(make("span", undefined, window.resets ?? "Reset time unavailable"));
      if (window.pace) {
        const pace = make("b", undefined, PACE_LABEL[window.pace]);
        pace.dataset.pace = window.pace;
        foot.append(pace);
      }
      row.append(head, bar, foot);
      return { row, hasLine };
    };

    ipcRenderer.on(
      USAGE_WIDGET_STATE_CHANNEL,
      (
        _event,
        state: {
          layout: UsageWidgetLayout;
          alwaysOnTop: boolean;
          snapshot: UsageWidgetSnapshot;
        },
      ) => {
        layout = state.layout;
        const pinLabel = state.alwaysOnTop
          ? "Stop keeping above other windows"
          : "Keep above other windows";
        pinButton.setAttribute("aria-pressed", String(state.alwaysOnTop));
        pinButton.setAttribute("aria-label", pinLabel);
        pinButton.title = pinLabel;
        document.body.dataset.layout = layout;
        columns = layout === "horizontal" ? Math.max(1, state.snapshot.groups.length) : 1;
        const next = layout === "vertical" ? "horizontal" : "vertical";
        layoutButton.setAttribute("aria-label", `Switch to ${next} layout`);
        layoutButton.title = `Switch to ${next} layout`;

        let anyLine = false;
        const sections = state.snapshot.groups.map((group) => {
          const section = make("section");
          section.style.setProperty("--chart", group.color ?? "var(--fg)");
          const heading = make("h2");
          heading.append(make("i"), group.label);
          const badge = make(
            "span",
            undefined,
            group.connected
              ? `${group.accounts} account${group.accounts === 1 ? "" : "s"}`
              : "Offline, last known",
          );
          badge.dataset.offline = String(!group.connected);
          heading.append(badge);
          section.append(heading);
          for (const window of group.windows) {
            const { row, hasLine } = renderWindow(group, window);
            anyLine ||= hasLine;
            section.append(row);
          }
          if (group.windows.length === 0) section.append(make("p", "foot", "No limits reported."));
          return section;
        });
        groups.replaceChildren(...sections);
        empty.hidden = sections.length > 0;
        empty.textContent = "No connected provider reports subscription limits.";
        legend.hidden = !anyLine;
        notices.textContent = state.snapshot.notices.join("\n");
        rescale();
        reportFit();
      },
    );
    act("ready");
  },
  { once: true },
);
