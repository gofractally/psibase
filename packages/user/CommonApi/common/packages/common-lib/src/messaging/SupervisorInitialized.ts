export const SUPERVISOR_INITIALIZED = "SUPERVISOR_INITIALIZED" as const;

export interface SupervisorInitialized {
    type: typeof SUPERVISOR_INITIALIZED;
    payload: {};
}

export const isSupervisorInitialized = (
    message: any,
): message is SupervisorInitialized => {
    // TODO add further assertions on expectations in the payload.
    return message && message.type == SUPERVISOR_INITIALIZED;
};

export const buildMessageSupervisorInitialized = (): SupervisorInitialized => ({
    payload: {},
    type: SUPERVISOR_INITIALIZED,
});
