import { useEffect, useState } from "react";

import { useWebRtcSession } from "@shared/domains/webrtc";

export type PresenceUi = "online" | "offline" | "unknown";

/**
 * Subscribes to x-wrtcsig presence snapshot + deltas for the current page load.
 * Clears local presence when the websocket goes offline.
 */
export function useRealtimePresence(): {
    connectionState: ReturnType<typeof useWebRtcSession>["connectionState"];
    presenceReady: boolean;
    presenceByAccount: Record<string, PresenceUi>;
} {
    const { connectionState, registerHandlers } = useWebRtcSession();
    const [presenceReady, setPresenceReady] = useState(false);
    const [presenceByAccount, setPresenceByAccount] = useState<
        Record<string, PresenceUi>
    >({});

    useEffect(() => {
        if (connectionState === "offline") {
            setPresenceReady(false);
            setPresenceByAccount({});
        }
    }, [connectionState]);

    useEffect(() => {
        return registerHandlers({
            presenceSnapshot: (frame) => {
                setPresenceReady(true);
                const merged: Record<string, PresenceUi> = {};
                for (const row of frame.peers) {
                    merged[row.account] =
                        row.presence === "online" ? "online" : "offline";
                }
                setPresenceByAccount(merged);
            },
            presence: (frame) => {
                const nextStatus: PresenceUi =
                    frame.status === "online" ? "online" : "offline";
                setPresenceByAccount((prev) => ({
                    ...prev,
                    [frame.account]: nextStatus,
                }));
            },
        });
    }, [registerHandlers]);

    return { connectionState, presenceReady, presenceByAccount };
}
