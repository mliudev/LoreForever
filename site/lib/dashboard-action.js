// Request-local state, never controllable through JSON/env flags. Legacy callers keep
// their behavior; the dashboard records ambiguous provider results for reconciliation.
const actions = new WeakMap();
export const isDashboardAction = env => actions.has(env?.DB);
export function dashboardActionDatabase(source) {
  const DB = {
    prepare: (...args) => source.prepare(...args),
    batch: (...args) => source.batch(...args),
  };
  const state = { uncertain: false };
  actions.set(DB, state);
  return { DB, assertKnown() { if (state.uncertain) throw new Error("Provider outcome is unknown."); } };
}
export function markActionUncertain(env) {
  const state = actions.get(env?.DB);
  if (state) state.uncertain = true;
}
export const actionIsUncertain = env => actions.get(env?.DB)?.uncertain === true;
