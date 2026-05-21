import type { ReactNode } from "react";
import { useMemo } from "react";

import { WebRtcSessionProvider } from "@shared/domains/webrtc";

import { chatDataRecord } from "./lib/chat-data-debug";
import { getHomepageQueryToken } from "./lib/ws-auth";

type ChatAppShellProps = {
    children: ReactNode;
};

const CHAT_RECONNECT = {
    initialDelayMs: 500,
    maxDelayMs: 30_000,
} as const;

/**
 * Chat app root for one page load. Owns x-webrtc-sig transport via shared
 * {@link WebRtcSessionProvider}; messaging orchestrators live in useChatSocket.
 */
export function ChatAppShell({ children }: ChatAppShellProps) {
    const debugLog = useMemo(
        () => (event: string, detail?: Record<string, unknown>) =>
            chatDataRecord(event, detail),
        [],
    );
    const autoConnect =
        typeof window === "undefined" ||
        new URLSearchParams(window.location.search).get("churnNoRealtime") !==
            "1";

    return (
        <WebRtcSessionProvider
            authTokenProvider={getHomepageQueryToken}
            authRequiredMessage="Sign in to Chat to connect (choose an account when prompted)."
            debugLog={debugLog}
            reconnect={CHAT_RECONNECT}
            autoConnect={autoConnect}
        >
            {children}
        </WebRtcSessionProvider>
    );
}
