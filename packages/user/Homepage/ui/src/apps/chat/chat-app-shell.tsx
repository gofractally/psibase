import type { ReactNode } from "react";

import { WebRtcSessionProvider } from "@shared/domains/webrtc";

import { getHomepageQueryToken } from "./lib/ws-auth";

type ChatAppShellProps = {
    children: ReactNode;
};

const CHAT_RECONNECT = {
    initialDelayMs: 500,
    maxDelayMs: 30_000,
} as const;

/**
 * Chat app root for one page load. Owns x-wrtcsig transport via shared
 * {@link WebRtcSessionProvider}. Presence UI mounts under this shell in PR3;
 * messaging orchestrators arrive in later PRs.
 */
export function ChatAppShell({ children }: ChatAppShellProps) {
    return (
        <WebRtcSessionProvider
            authTokenProvider={getHomepageQueryToken}
            authRequiredMessage="Sign in to Chat to connect (choose an account when prompted)."
            reconnect={CHAT_RECONNECT}
        >
            {children}
        </WebRtcSessionProvider>
    );
}
