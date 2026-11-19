// Google's free keys allow only so many requests a minute. When a call fails
// for that reason, wait and try again instead of counting it as a wrong answer.

/** Runs `fn`, retrying after `delayMs` when it throws. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 4, delayMs = 30_000 } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
