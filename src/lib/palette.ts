export const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
// Dark-mode step for each palette colour. Custom colours pass through unchanged.
export const DARK_STEP: Record<string, string> = {
  "#2a78d6": "#3987e5", "#eb6834": "#d95926", "#1baf7a": "#199e70", "#eda100": "#c98500",
  "#e87ba4": "#d55181", "#008300": "#008300", "#4a3aa7": "#9085e9", "#e34948": "#e66767",
};

// Style for elements that use var(--c): CSS (.c-ws in globals.css) picks the light or dark step,
// so server-rendered markup is right in any theme without JS.
export const wsVars = (color: string) =>
  ({ "--c-l": color, "--c-d": DARK_STEP[color.toLowerCase()] }) as React.CSSProperties;
