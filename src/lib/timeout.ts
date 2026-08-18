// A generic race against the clock, used wherever an operation this app believes will either
// succeed or fail promptly instead does neither — leaving nothing on screen to tell a person apart
// a long-but-normal wait from one that will never end.

/**
 * Races `promise` against a `ms` timer, rejecting with `new Error(timeoutMessage)` if the timer
 * wins. `promise` itself is not cancelled: nothing here can reach into a fetch already in flight or
 * a decoder already handed a frame, so the abandoned attempt may keep running in the background.
 * What this buys instead is the one thing a caller actually needs — an answer, one way or another,
 * within `ms` — rather than a promise that may simply never settle.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
