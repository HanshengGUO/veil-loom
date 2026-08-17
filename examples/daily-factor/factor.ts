/** Two-session close momentum used only by the deterministic reference adapter fixture. */
export function dailyFactor(close: readonly number[]): readonly number[] {
  return close.map((_, index) => {
    if (index < 2) return 0;
    return (close[index - 1] ?? 0) - (close[index - 2] ?? 0);
  });
}
