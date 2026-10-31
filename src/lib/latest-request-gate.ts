/** Protects room state from out-of-order asynchronous refresh responses.
 * Each request gets a monotonically increasing ticket; only the latest
 * request can publish its snapshot or surface its error.
 */
export function createLatestRequestGate() {
  let current = 0;
  return {
    begin: (): number => ++current,
    isCurrent: (ticket: number): boolean => ticket > 0 && ticket === current,
  };
}
