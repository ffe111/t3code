export function usageWidgetBounds(
  position: { readonly x: number; readonly y: number } | null,
  size: { readonly width: number; readonly height: number },
  workArea: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
) {
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  return {
    width,
    height,
    x: Math.round(
      Math.max(
        workArea.x,
        Math.min(
          position?.x ?? workArea.x + workArea.width - width - 16,
          workArea.x + workArea.width - width,
        ),
      ),
    ),
    y: Math.round(
      Math.max(
        workArea.y,
        Math.min(position?.y ?? workArea.y + 16, workArea.y + workArea.height - height),
      ),
    ),
  };
}
