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

/** Publish a static room snapshot only after every read succeeds, and only
 * when no newer request has started. Obsolete failures are ignored.
 */
export async function applyLatestSnapshot<T>(
  gate: ReturnType<typeof createLatestRequestGate>,
  load: () => Promise<T>,
  publish: (snapshot: T) => void,
): Promise<boolean> {
  const ticket = gate.begin();
  try {
    const snapshot = await load();
    if (!gate.isCurrent(ticket)) return false;
    publish(snapshot);
    return true;
  } catch (error) {
    if (gate.isCurrent(ticket)) throw error;
    return false;
  }
}
