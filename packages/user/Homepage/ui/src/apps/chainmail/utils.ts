const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (ts: number) => {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
};

export const isSameDay = (a: number, b: number) =>
    startOfDay(a) === startOfDay(b);

export const formatClock = (ts: number) =>
    new Date(ts).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
    });

/** Compact timestamp for list rows: time today, weekday this week, else date. */
export const formatChatTime = (ts: number) => {
    const days = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / DAY_MS);
    if (days <= 0) return formatClock(ts);
    if (days === 1) return "Yesterday";
    if (days < 7)
        return new Date(ts).toLocaleDateString(undefined, { weekday: "short" });
    return new Date(ts).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
    });
};

/** Separator label between days in a thread. */
export const formatDayLabel = (ts: number) => {
    const days = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / DAY_MS);
    if (days <= 0) return "Today";
    if (days === 1) return "Yesterday";
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
        ...(d.getFullYear() !== new Date().getFullYear()
            ? { year: "numeric" }
            : {}),
    });
};

export const firstLine = (text: string) =>
    text.trim().split("\n")[0]?.trim() ?? "";
