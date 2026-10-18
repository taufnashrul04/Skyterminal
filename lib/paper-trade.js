export function projectPaperTrade(route, { capital = 1000, hours = 4, costBps = 0 } = {}) {
  const notional = Number(capital);
  const horizon = Number(hours);
  const cost = notional * Number(costBps) / 10_000;
  const grossFunding = notional * Number(route.grossRate1h || 0) * horizon;
  return {
    grossFunding: Number(grossFunding.toFixed(2)),
    estimatedCost: Number(cost.toFixed(2)),
    projectedNet: Number((grossFunding - cost).toFixed(2)),
  };
}

export function createPaperTrade(route, options = {}) {
  const capital = Number(options.capital ?? 1000);
  const hours = Number(options.hours ?? 4);
  const costBps = Number(options.costBps ?? 0);
  const projection = projectPaperTrade(route, { capital, hours, costBps });
  return {
    id: options.id ?? `paper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: options.createdAt ?? new Date().toISOString(),
    status: 'OPEN',
    capital,
    hours,
    costBps,
    pair: route.pair,
    longDex: route.longDex,
    shortDex: route.shortDex,
    longRate1h: Number(route.longRate1h || 0),
    shortRate1h: Number(route.shortRate1h || 0),
    grossRate1h: Number(route.grossRate1h || 0),
    ...projection,
  };
}
