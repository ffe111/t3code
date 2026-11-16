import * as Schema from "effect/Schema";

export const UsageWidgetLayout = Schema.Literals(["vertical", "horizontal"]);
export type UsageWidgetLayout = typeof UsageWidgetLayout.Type;

export const UsageWidgetPreferences = Schema.Struct({
  visible: Schema.Boolean,
  layout: UsageWidgetLayout,
  position: Schema.NullOr(Schema.Struct({ x: Schema.Int, y: Schema.Int })),
  // Missing means pinned above other windows.
  alwaysOnTop: Schema.optionalKey(Schema.Boolean),
  // Null follows the content; a size means the user resized the widget.
  size: Schema.optionalKey(Schema.NullOr(Schema.Struct({ width: Schema.Int, height: Schema.Int }))),
});
export type UsageWidgetPreferences = typeof UsageWidgetPreferences.Type;

export const UsageWidgetSnapshot = Schema.Struct({
  groups: Schema.Array(
    Schema.Struct({
      label: Schema.String,
      // The provider's chart color; null follows the widget's foreground.
      color: Schema.NullOr(Schema.String),
      accounts: Schema.Int,
      connected: Schema.Boolean,
      windows: Schema.Array(
        Schema.Struct({
          label: Schema.String,
          remainingPercent: Schema.Number,
          pace: Schema.NullOr(Schema.Literals(["ahead", "on", "under"])),
          // One bar segment per account; the line marks how much of the window is left.
          segments: Schema.Array(
            Schema.Struct({
              remainingPercent: Schema.NullOr(Schema.Number),
              timeLeftPercent: Schema.NullOr(Schema.Number),
            }),
          ),
          resets: Schema.NullOr(Schema.String),
        }),
      ),
    }),
  ),
  notices: Schema.Array(Schema.String),
});
export type UsageWidgetSnapshot = typeof UsageWidgetSnapshot.Type;
