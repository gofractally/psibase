export function formatDistanceToNow(dateString: string | number): string {
    const date = new Date(dateString);
    const now = new Date();

    const diffInMilliseconds = now.getTime() - date.getTime();
    const diffInMinutes = Math.floor(diffInMilliseconds / (1000 * 60));
    const diffInHours = Math.floor(diffInMilliseconds / (1000 * 60 * 60));
    const diffInDays = Math.floor(diffInMilliseconds / (1000 * 60 * 60 * 24));

    if (diffInMinutes < 60) {
        return `${diffInMinutes}m ago`;
    } else if (diffInHours < 24) {
        return `${diffInHours}h ago`;
    } else if (diffInDays < 7) {
        return `${diffInDays}d ago`;
    } else {
        return formatDate(dateString, true);
    }
}

export function formatDate(dateString: string | number, short = false): string {
    const date = new Date(dateString);

    if (short) {
        return date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
        });
    }

    return date.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

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
