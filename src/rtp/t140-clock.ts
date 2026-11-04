/**
 * RTP timestamp source for text/t140.
 *
 * RFC 4103 §3: the timestamp "encodes the approximate instance of entry of
 * the primary text in the packet. A clock frequency of 1000 Hz MUST be used.
 * Sequential packets MUST NOT use the same timestamp."
 * https://www.rfc-editor.org/rfc/rfc4103#section-3
 *
 * The default clock returns milliseconds since creation (plus the initial
 * offset) and always advances by at least one tick, so two packets built in
 * the same millisecond still get distinct timestamps. Values wrap at 2^32.
 *
 * With `fixedIncrement` the clock ignores wall time and adds that amount per
 * packet. This keeps the legacy `timestampIncrement` option working.
 */
export interface T140Clock {
  /** Timestamp for the next packet. Advances the clock. */
  next(): number;
  /** Current clock reading without advancing it. Used for FEC packets. */
  now(): number;
}

export function createT140Clock(initialTimestamp = 0, fixedIncrement?: number): T140Clock {
  const startedAt = Date.now();
  let last: number | undefined;
  const wallClock = (): number => (initialTimestamp + (Date.now() - startedAt)) >>> 0;

  if (fixedIncrement !== undefined) {
    return {
      now: () => last ?? initialTimestamp,
      next: () => {
        last = last === undefined ? initialTimestamp : (last + fixedIncrement) >>> 0;
        return last;
      },
    };
  }

  return {
    now: wallClock,
    next: () => {
      const reading = wallClock();
      last = last === undefined ? reading : Math.max(reading, (last + 1) >>> 0);
      return last;
    },
  };
}
