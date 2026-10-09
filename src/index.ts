import { formatLocal, getSessionTick, slotFromCron } from "./schedule";
import { mapReduceWake } from "./zai";

function windowHours(env: Env): number {
  const n = Number(env.AI_WINDOW_HOURS ?? "5");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}

async function callZaiWake(
  env: Env,
  reason: string,
  local: string,
  slot: {
    startLabel: string;
    offset: number;
    localHour: number;
    localMinute: number;
  },
  hours: number,
  timezone: string,
): Promise<Record<string, unknown>> {
  if (!env.ZAI_API_KEY) {
    throw new Error("ZAI_API_KEY secret is not set");
  }

  const timeLabel = `${String(slot.localHour).padStart(2, "0")}:${String(slot.localMinute).padStart(2, "0")}`;
  const prompts = [
    `Session start ${slot.startLabel} (${timezone}). Now ${timeLabel} local — hour ${slot.offset + 1} of ${hours}. Reason: ${reason}. Give a short focus check for this hour.`,
  ];

  const { parts, summary } = await mapReduceWake(
    env.ZAI_API_KEY,
    env.ZAI_MODEL || "glm-5.3-flash",
    prompts,
  );

  return {
    ok: true,
    skipped: false,
    api: "z.ai",
    reason,
    local,
    slot,
    parts,
    summary,
  };
}

/** Cron path: always call Z.AI when the cron maps to a slot. */
async function runCronWake(
  env: Env,
  cron: string,
  scheduledTime: Date,
): Promise<Record<string, unknown>> {
  const timezone = env.AI_TIMEZONE || "Asia/Dhaka";
  const hours = windowHours(env);
  const slot = slotFromCron(cron, scheduledTime, env.AI_TIME, hours);
  const local = formatLocal(scheduledTime, timezone);

  if (!slot) {
    return {
      ok: true,
      skipped: true,
      reason: "cron_slot_mismatch",
      cron,
      local,
      aiTime: env.AI_TIME,
    };
  }

  return callZaiWake(
    env,
    `cron:${cron}`,
    local,
    slot,
    hours,
    timezone,
  );
}

export default {
  /** Public HTTP is closed — this Worker only runs via Cron Triggers. */
  async fetch(): Promise<Response> {
    return new Response(
      JSON.stringify({ error: "forbidden", detail: "cron-only worker" }),
      {
        status: 403,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const run = (async () => {
      try {
        const result = await runCronWake(
          env,
          controller.cron,
          new Date(controller.scheduledTime),
        );
        console.log(JSON.stringify(result));
      } catch (err) {
        console.error(
          "scheduled wake failed",
          err instanceof Error ? err.message : err,
        );
        throw err;
      }
    })();

    ctx.waitUntil(run);
    await run;
  },
} satisfies ExportedHandler<Env>;
