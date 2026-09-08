import {
    differenceInSeconds,
    format,
    formatDistanceToNowStrict,
} from "date-fns";

/** psibase emits timestamps like 2026-09-08T20:31:15.000000Z (6 fractional digits). */
export const parseChainTime = (time: string): Date => {
    const trimmed = time.replace(/\.(\d{3})\d*Z$/, ".$1Z");
    return new Date(trimmed);
};

export const formatTime = (time: string | Date) => {
    const d = typeof time === "string" ? parseChainTime(time) : time;
    return format(d, "MMM d, yyyy HH:mm:ss");
};

export const formatClock = (time: string | Date) => {
    const d = typeof time === "string" ? parseChainTime(time) : time;
    return format(d, "HH:mm:ss");
};

export const formatUtc = (time: string | Date) => {
    const d = typeof time === "string" ? parseChainTime(time) : time;
    return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
};

export const formatAge = (time: string | Date, now = new Date()) => {
    const d = typeof time === "string" ? parseChainTime(time) : time;
    const secs = Math.max(0, differenceInSeconds(now, d));
    if (secs < 1) return "just now";
    if (secs < 60) return `${secs}s ago`;
    if (secs < 3600) {
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        return s ? `${m}m ${s}s ago` : `${m}m ago`;
    }
    if (secs < 86400) {
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        return m ? `${h}h ${m}m ago` : `${h}h ago`;
    }
    return formatDistanceToNowStrict(d, { addSuffix: true });
};

export const shortHash = (hash: string, head = 6, tail = 6) => {
    if (!hash) return "";
    if (hash.length <= head + tail + 1) return hash;
    return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
};

export const formatNumber = (n: number | string | undefined | null) => {
    if (n === undefined || n === null || n === "") return "—";
    const num = typeof n === "string" ? Number(n) : n;
    if (Number.isNaN(num)) return String(n);
    return new Intl.NumberFormat("en-US").format(num);
};

export const formatCompact = (n: number) =>
    new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1,
    }).format(n);

export const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KiB", "MiB", "GiB"];
    let value = bytes / 1024;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i++;
    }
    return `${value.toFixed(value < 10 ? 2 : 1)} ${units[i]}`;
};

export const formatSeconds = (secs: number, digits = 2) => {
    if (!Number.isFinite(secs)) return "—";
    if (secs < 1) return `${Math.round(secs * 1000)} ms`;
    return `${secs.toFixed(digits)} s`;
};

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

/** Hex-encoded payload length in bytes. */
export const hexByteLength = (hex: string | undefined) =>
    hex ? Math.floor(hex.length / 2) : 0;

/** Try to render hex payload as UTF-8 if it looks printable. */
export const hexToPrintable = (hex: string): string | null => {
    if (!hex || hex.length % 2 !== 0) return null;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    let printable = 0;
    for (const b of bytes) {
        if ((b >= 0x20 && b < 0x7f) || b === 0x0a || b === 0x09) printable++;
    }
    if (bytes.length === 0 || printable / bytes.length < 0.85) return null;
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        return null;
    }
};

export const blockNumFromId = (id: string): number | null => {
    if (!/^[0-9a-fA-F]{64}$/.test(id)) return null;
    return parseInt(id.slice(0, 8), 16);
};

export const isHash = (value: string) => /^[0-9a-fA-F]{64}$/.test(value);

export const isAccountName = (value: string) =>
    /^[a-z0-9][a-z0-9-]{0,17}(\+\d+)?$/.test(value);

export const pct = (part: number, total: number, digits = 1) =>
    total === 0 ? "0%" : `${((part / total) * 100).toFixed(digits)}%`;
