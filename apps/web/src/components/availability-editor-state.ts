export type AvailabilityLoadState = "loading" | "loaded" | "error";

export function canMutateAvailability(loadState: AvailabilityLoadState) {
  return loadState === "loaded";
}

export function availabilitySaveResultIsCurrent(submittedRevision: number, currentRevision: number) {
  return submittedRevision === currentRevision;
}
