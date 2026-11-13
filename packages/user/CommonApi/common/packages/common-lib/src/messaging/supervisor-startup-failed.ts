export const SUPERVISOR_STARTUP_FAILED = "SUPERVISOR_STARTUP_FAILED" as const;

export interface SupervisorStartupFailed {
    type: typeof SUPERVISOR_STARTUP_FAILED;
    payload: {
        message: string;
    };
}

export const isSupervisorStartupFailed = (
    message: unknown,
): message is SupervisorStartupFailed => {
    if (typeof message !== "object" || message === null) {
        return false;
    }
    if (!("type" in message) || message.type != SUPERVISOR_STARTUP_FAILED) {
        return false;
    }
    if (!("payload" in message)) {
        return false;
    }
    const payload = message.payload;
    return (
        typeof payload === "object" &&
        payload !== null &&
        "message" in payload &&
        typeof payload.message === "string"
    );
};

export const buildMessageSupervisorStartupFailed = (
    message: string,
): SupervisorStartupFailed => ({
    payload: { message },
    type: SUPERVISOR_STARTUP_FAILED,
});
