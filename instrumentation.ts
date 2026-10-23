// Starts the in-app batch scheduler when BATCH_SCHEDULER=on (default off; jobs run by `npm run batch -- Bn` meanwhile).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.BATCH_SCHEDULER === "on") {
    const { startScheduler } = await import("@/lib/batch/scheduler");
    startScheduler();
  }
}
