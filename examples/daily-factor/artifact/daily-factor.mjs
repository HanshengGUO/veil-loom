/** The same two-session close-momentum rule identified by the Raw reference view. */
export function compute(table, context) {
  const ticker = table.getChild("ticker");
  const close = table.getChild("close");
  if (ticker === null || close === null) throw new Error("verification view is missing inputs");
  if (context.paramsLocked.lookback_days !== 2) throw new Error("unsupported locked lookback");
  const rowIndices = Array.from({ length: table.numRows }, (_, index) => index);
  const history = new Map();
  const score = rowIndices.map((row) => {
    const entity = String(ticker.get(row));
    const values = history.get(entity) ?? [];
    const value = close.get(row);
    const result = values.length < 2 ? null : values.at(-1) - values.at(-2);
    if (value !== null) values.push(Number(value));
    history.set(entity, values);
    return result;
  });
  return {
    rowIndices,
    columns: { score },
  };
}
