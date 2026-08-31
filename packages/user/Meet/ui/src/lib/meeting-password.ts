const storageKey = (meetingId: string) => `meet.password.${meetingId}`;

type CachedPassword = {
    hash: string;
    password: string;
};

export const storeMeetingPassword = (
    meetingId: string,
    hash: string,
    password: string,
) => {
    sessionStorage.setItem(
        storageKey(meetingId),
        JSON.stringify({ hash, password } satisfies CachedPassword),
    );
};

export const loadMeetingPassword = (
    meetingId: string,
    hash?: string | null,
): string | null => {
    const raw = sessionStorage.getItem(storageKey(meetingId));
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as Partial<CachedPassword>;
        if (
            parsed &&
            typeof parsed.password === "string" &&
            typeof parsed.hash === "string"
        ) {
            if (!hash || parsed.hash === hash) return parsed.password;
            return null;
        }
    } catch {
        // Ignore malformed cache.
    }
    return null;
};

export const parseSetMeetingResult = (raw: unknown) => {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!value || typeof value !== "object") {
        throw new Error("Invalid setMeeting result");
    }
    const { id, hash, password } = value as {
        id?: unknown;
        hash?: unknown;
        password?: unknown;
    };
    if (
        typeof hash !== "string" ||
        typeof password !== "string" ||
        (id !== undefined && typeof id !== "string")
    ) {
        throw new Error("Invalid setMeeting result");
    }
    return { id: typeof id === "string" ? id : undefined, hash, password };
};
