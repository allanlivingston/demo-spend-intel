// Default view vs advanced view. The default view has no workstreams, so it leaves out budget moves between
// them and the planned SOC 2 sprint (a workstream item): growth is funded through the budget owner brief. The engine
// defaults to advanced (tests and scripts); the app sets the mode from the demo menu.
let advanced = true;
export const isAdvanced = () => advanced;
/** Items that only make sense with workstreams; hidden from the default view (still counted in the forecast). */
export const shownInView = (driverId: string) => advanced || driverId !== "b-soc2";
export const setAdvancedView = (v: boolean) => {
  advanced = v;
};
