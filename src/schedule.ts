/**
 * Asia/Dhaka schedule helpers.
 * AI_TIME labels define window starts; each opens AI_WINDOW_HOURS hours.
 *
 * Supported labels:
 *   3am, 2pm          → hour, :00
 *   3:13pm, 14:00     → with colon
 *   0313pm, 1101pm    → compact HHmm + am/pm  (0313pm = 3:13pm)
 *   313pm             → compact Hmm + am/pm
 */

export type LocalTime = {
  hour: number;
  minute: number;
};

export type HourSlot = {
  /** Window start label from AI_TIME, e.g. "1101pm" */
  startLabel: string;
  /** Hour index within the window: 0 .. windowHours-1 */
  offset: number;
  /** Local hour 0–23 in Asia/Dhaka */
  localHour: number;
  /** Local minute 0–59 (same as start minute) */
  localMinute: number;
  /** Cron-friendly UTC hour for this slot */
  utcHour: number;
  /** Cron-friendly UTC minute (Dhaka has no DST → same as local) */
  utcMinute: number;
};

export type SessionTick = {
  now: Date;
  timezone: string;
  localHour: number;
  localMinute: number;
  localDate: string;
  active: boolean;
  slot: HourSlot | null;
  windowHours: number;
  starts: string[];
};

const DHAKA_OFFSET_HOURS = 6;

function to12h(hour12: number, period: "am" | "pm"): number {
  if (hour12 < 1 || hour12 > 12) throw new Error(`invalid hour: ${hour12}`);
  if (period === "am") return hour12 === 12 ? 0 : hour12;
  return hour12 === 12 ? 12 : hour12 + 12;
}

function assertMinute(minute: number, label: string): number {
  if (minute < 0 || minute > 59 || !Number.isInteger(minute)) {
    throw new Error(`invalid minute in: ${label}`);
  }
  return minute;
}

/**
 * Parse "3am", "0313pm", "1101pm", "3:13pm", "14:00" → local hour + minute.
 * Compact am/pm: last 2 digit groups are HHmm (4 digits) or Hmm (3 digits).
 */
export function parseTimeLabel(label: string): LocalTime {
  const raw = label.trim().toLowerCase();
  if (!raw) throw new Error("empty time label");

  // Compact: 0313pm, 1101pm, 313pm
  const compact = raw.match(/^(\d{3,4})(am|pm)$/);
  if (compact) {
    const digits = compact[1]!;
    const period = compact[2] as "am" | "pm";
    const minute = assertMinute(Number(digits.slice(-2)), label);
    const hour12 = Number(digits.slice(0, -2));
    return { hour: to12h(hour12, period), minute };
  }

  // 3am, 3:13pm, 11:01pm
  const ampm = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (ampm) {
    const period = ampm[3] as "am" | "pm";
    const minute = assertMinute(ampm[2] ? Number(ampm[2]) : 0, label);
    return { hour: to12h(Number(ampm[1]), period), minute };
  }

  // 14:00 or 14
  const hhmm = raw.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (hhmm) {
    const hour = Number(hhmm[1]);
    if (hour < 0 || hour > 23) throw new Error(`invalid hour: ${label}`);
    const minute = assertMinute(hhmm[2] ? Number(hhmm[2]) : 0, label);
    return { hour, minute };
  }

  throw new Error(`unrecognized time label: ${label}`);
}

/** @deprecated use parseTimeLabel — kept for hour-only callers */
export function parseTimeHour(label: string): number {
  return parseTimeLabel(label).hour;
}

export function parseAiTimes(aiTime: string): string[] {
  return aiTime
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function toUtc(localHour: number, localMinute: number): {
  utcHour: number;
  utcMinute: number;
} {
  return {
    utcHour: (localHour - DHAKA_OFFSET_HOURS + 24) % 24,
    utcMinute: localMinute,
  };
}

/** Map each AI_TIME start into `windowHours` consecutive local slots. */
export function mapWindowHours(
  aiTime: string,
  windowHours = 5,
): HourSlot[] {
  const starts = parseAiTimes(aiTime);
  return starts.flatMap((startLabel) => {
    const start = parseTimeLabel(startLabel);
    return Array.from({ length: windowHours }, (_, offset) => {
      const localHour = (start.hour + offset) % 24;
      const localMinute = start.minute;
      const { utcHour, utcMinute } = toUtc(localHour, localMinute);
      return {
        startLabel,
        offset,
        localHour,
        localMinute,
        utcHour,
        utcMinute,
      };
    });
  });
}

/** Reduce slots into cron expressions grouped by UTC minute. */
export function reduceCronPlan(slots: HourSlot[]): {
  utcHours: number[];
  cronExpressions: string[];
  windows: Array<{
    startLabel: string;
    localTimes: string[];
    utcHours: number[];
    utcMinute: number;
  }>;
} {
  const byStart = new Map<string, HourSlot[]>();
  for (const slot of slots) {
    const list = byStart.get(slot.startLabel) ?? [];
    list.push(slot);
    byStart.set(slot.startLabel, list);
  }

  const windows = [...byStart.entries()].map(([startLabel, group]) => ({
    startLabel,
    localTimes: group.map(
      (s) =>
        `${String(s.localHour).padStart(2, "0")}:${String(s.localMinute).padStart(2, "0")}`,
    ),
    utcHours: group.map((s) => s.utcHour),
    utcMinute: group[0]?.utcMinute ?? 0,
  }));

  const byMinute = new Map<number, Set<number>>();
  for (const slot of slots) {
    const hours = byMinute.get(slot.utcMinute) ?? new Set<number>();
    hours.add(slot.utcHour);
    byMinute.set(slot.utcMinute, hours);
  }

  const cronExpressions = [...byMinute.entries()]
    .sort(([a], [b]) => a - b)
    .map(([minute, hours]) => {
      const utcHours = [...hours].sort((a, b) => a - b);
      return `${minute} ${utcHours.join(",")} * * *`;
    });

  const utcHours = [...new Set(slots.map((s) => s.utcHour))].sort(
    (a, b) => a - b,
  );

  return { utcHours, cronExpressions, windows };
}

function localParts(now: Date, timezone: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  );
  return {
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    localHour: Number(parts.hour),
    localMinute: Number(parts.minute),
  };
}

function minutesOfDay(hour: number, minute: number): number {
  return hour * 60 + minute;
}

/** Continuous window check: [start, start + windowHours). */
function inWindow(
  localHour: number,
  localMinute: number,
  start: LocalTime,
  windowHours: number,
): boolean {
  const nowM = minutesOfDay(localHour, localMinute);
  const startM = minutesOfDay(start.hour, start.minute);
  const endM = startM + windowHours * 60;
  const day = 24 * 60;

  if (endM <= day) {
    return nowM >= startM && nowM < endM;
  }
  // wraps past midnight
  return nowM >= startM || nowM < endM - day;
}

/** Is `now` inside any mapped AI window for Asia/Dhaka? */
export function getSessionTick(
  now: Date,
  aiTime: string,
  timezone = "Asia/Dhaka",
  windowHours = 5,
): SessionTick {
  const starts = parseAiTimes(aiTime);
  const slots = mapWindowHours(aiTime, windowHours);
  const { localDate, localHour, localMinute } = localParts(now, timezone);

  const active = starts.some((label) =>
    inWindow(localHour, localMinute, parseTimeLabel(label), windowHours),
  );

  // Prefer an exact cron tick match (same local hour + start minute).
  const slot =
    slots.find(
      (s) => s.localHour === localHour && s.localMinute === localMinute,
    ) ??
    (active
      ? (slots.find((s) => {
          const start = parseTimeLabel(s.startLabel);
          if (!inWindow(localHour, localMinute, start, windowHours)) return false;
          const elapsed =
            (minutesOfDay(localHour, localMinute) -
              minutesOfDay(start.hour, start.minute) +
              24 * 60) %
            (24 * 60);
          return Math.floor(elapsed / 60) === s.offset && s.localMinute === start.minute;
        }) ?? null)
      : null);

  return {
    now,
    timezone,
    localHour,
    localMinute,
    localDate,
    active,
    slot,
    windowHours,
    starts,
  };
}

export function formatLocal(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
    hourCycle: "h23",
  }).format(now);
}

/**
 * Resolve the slot for a Cloudflare cron fire.
 * Uses the cron minute + UTC hour so delayed delivery still hits Z.AI.
 */
export function slotFromCron(
  cron: string,
  scheduledTime: Date,
  aiTime: string,
  windowHours = 5,
): HourSlot | null {
  const minuteField = cron.trim().split(/\s+/)[0];
  const cronMinute = Number(minuteField);
  if (!Number.isInteger(cronMinute) || cronMinute < 0 || cronMinute > 59) {
    return null;
  }

  const utcHour = scheduledTime.getUTCHours();
  const slots = mapWindowHours(aiTime, windowHours);
  return (
    slots.find((s) => s.utcMinute === cronMinute && s.utcHour === utcHour) ??
    null
  );
}
