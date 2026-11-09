// A deadline for the whole auth operation, including SDK session/storage locks.
// Timing out does not prove the server rejected an account creation request.
export async function withAuthDeadline(operation, timeoutMs = 20000) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('The authentication service took too long to respond.');
          error.code = 'AUTH_TIMEOUT';
          reject(error);
        }, timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
