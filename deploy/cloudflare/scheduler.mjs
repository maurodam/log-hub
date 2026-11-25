export default {
  async scheduled(_controller, env) {
    const baseUrl = new URL(env.LOGHUB_URL);
    if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password || !env.LOGHUB_SCHEDULER_SECRET) {
      throw new Error("Set an HTTPS LOGHUB_URL and the LOGHUB_SCHEDULER_SECRET Worker secret");
    }

    const jobs = ["alerts", "webhooks", "retention"];
    const results = await Promise.allSettled(jobs.map(async (job) => {
      const response = await fetch(new URL(`/api/internal/jobs/${job}`, baseUrl), {
        method: "POST",
        headers: { Authorization: `Bearer ${env.LOGHUB_SCHEDULER_SECRET}` },
        redirect: "error",
      });
      await response.body?.cancel();
      if (response.status !== 204) {
        throw new Error(`HTTP ${response.status}`);
      }
    }));

    const failures = results.flatMap((result, index) =>
      result.status === "rejected" ? [`${jobs[index]}: ${result.reason}`] : []);
    if (failures.length > 0) {
      throw new Error(failures.join(", "));
    }
  },
};
