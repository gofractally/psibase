import dayjs from "dayjs";

/** psibase emits timestamps like 2026-09-08T20:31:15.000000Z (6 fractional digits). */
export const parseChainTime = (time: string): Date =>
    new Date(time.replace(/\.(\d{3})\d*Z$/, ".$1Z"));

export const formatChainTime = (time: string) =>
    dayjs(parseChainTime(time)).format("MMM D, YYYY HH:mm:ss");

/** Up to the three most significant units: "412d 7h 3m", "5m 12s". */
export const formatDuration = (totalSeconds: number) => {
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "—";
    const d = Math.floor(totalSeconds / 86400);
    const h = Math.floor((totalSeconds % 86400) / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    const parts: string[] = [];
    if (d) parts.push(`${d}d`);
    if (h || d) parts.push(`${h}h`);
    if (m || h || d) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.slice(0, 3).join(" ");
};

/** Whole minutes, never less than one: "1 minute", "12 minutes". */
export const formatMinutes = (totalSeconds: number) => {
    const m = Math.max(1, Math.round(totalSeconds / 60));
    return `${m.toLocaleString()} minute${m === 1 ? "" : "s"}`;
};

export const formatSecondsAgo = (secs: number) =>
    secs < 1 ? "just now" : `${formatDuration(secs)} ago`;

/** Short, friendly number for headline figures: 84, 1,204.5, 2.4M. */
export const formatCompact = (n: number) =>
    Math.abs(n) >= 100_000
        ? new Intl.NumberFormat(undefined, {
              notation: "compact",
              maximumFractionDigits: 1,
          }).format(n)
        : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
