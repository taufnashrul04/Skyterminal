export function normalizePanelState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, collapsed]) => typeof collapsed === 'boolean'));
}

export function setPanelCollapsed(state, panelId, collapsed) {
  return { ...normalizePanelState(state), [String(panelId)]: Boolean(collapsed) };
}
