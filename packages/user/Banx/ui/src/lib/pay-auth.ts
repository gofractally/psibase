const DAY_SECONDS = 24 * 60 * 60;
const U32_MAX = 4_294_967_295;

/** Largest whole-day period that fits in the chain's u32 second count. */
export const MAX_PERIOD_DAYS = Math.floor(U32_MAX / DAY_SECONDS);

export function periodDaysError(value: number): string | undefined {
    if (!Number.isInteger(value) || value < 1) {
        return "Enter a whole number of days";
    }
    if (value > MAX_PERIOD_DAYS) return "Period is too long";
    return undefined;
}

/** Whole days to `period_seconds`, or null when the value cannot be stored. */
export function periodSecondsFromDays(days: number): number | null {
    if (periodDaysError(days)) return null;
    return days * DAY_SECONDS;
}

export type PayAuthSchedule = {
    nextDue: number;
    endsAt: number;
    periodSeconds: number;
};

/** Periods whose start is due and still allowed by `endsAt` (0 = no end). */
export function dueCount(row: PayAuthSchedule, nowSec: number): number {
    if (row.periodSeconds <= 0) return 0;
    let count = 0;
    let due = row.nextDue;
    while (due <= nowSec && (row.endsAt === 0 || due < row.endsAt)) {
        count += 1;
        const next = due + row.periodSeconds;
        if (next <= due || count >= 10_000) break;
        due = next;
    }
    return count;
}

export function seriesEnded(row: PayAuthSchedule): boolean {
    return row.endsAt !== 0 && row.nextDue >= row.endsAt;
}

export function periodLabel(seconds: number): string {
    if (seconds > 0 && seconds % DAY_SECONDS === 0) {
        const days = seconds / DAY_SECONDS;
        return days === 1 ? "1 day" : `${days.toLocaleString()} days`;
    }
    return `${seconds.toLocaleString()} seconds`;
}

export function formatUnix(seconds: number): string {
    return new Date(seconds * 1000).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    });
}

export function toLocalInput(unix: number): string {
    const d = new Date(unix * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): number | null {
    if (!value.trim()) return null;
    const ms = new Date(value).getTime();
    if (!Number.isFinite(ms)) return null;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 0 || seconds > U32_MAX) return null;
    return seconds;
}
