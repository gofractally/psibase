import { Button } from "@shared/shadcn/ui/button";
import { AlertTriangle, Loader2, Wifi, WifiOff } from "lucide-react";

import type { RealtimeConnectionState } from "../lib/realtime-client";
import { cn } from "@shared/lib/utils";

type Props = {
    connectionState: RealtimeConnectionState;
    lastRealtimeError: string | null;
    lastInboundError: string | null;
    /** Surfaces "outbox storage is full" with a specific tone. */
    pendingStorageQuotaExceeded?: boolean;
    authLost: boolean;
    presenceReady: boolean;
    onReconnect: () => void;
};

/**
 * Status strip for x-wrtcsig realtime transport: connected / reconnecting / offline.
 */
export function ConnectionStatusBanner({
    connectionState,
    lastRealtimeError,
    lastInboundError,
    pendingStorageQuotaExceeded,
    authLost,
    presenceReady,
    onReconnect,
}: Props) {
    if (
        connectionState === "connected" &&
        presenceReady &&
        !authLost &&
        !lastInboundError &&
        !pendingStorageQuotaExceeded
    ) {
        return null;
    }

    const detail = lastInboundError || lastRealtimeError || "";

    let tone: "default" | "warn" | "danger" | "muted" = "muted";
    let Icon = Loader2;
    let headline = "";

    if (authLost) {
        tone = "danger";
        Icon = AlertTriangle;
        headline = "Sign-in expired or blocked";
    } else if (pendingStorageQuotaExceeded) {
        tone = "danger";
        Icon = AlertTriangle;
        headline = "Outbox storage is full";
    } else if (lastInboundError) {
        tone = "warn";
        Icon = AlertTriangle;
        headline = "Chat action failed";
    } else if (connectionState === "offline") {
        tone = "warn";
        Icon = WifiOff;
        headline = "Offline";
    } else if (connectionState === "reconnecting") {
        tone = "warn";
        Icon = Loader2;
        headline = "Reconnecting…";
    } else if (!presenceReady) {
        tone = "muted";
        Icon = Loader2;
        headline = "Connecting…";
    } else {
        tone = "muted";
        Icon = Wifi;
        headline = "Connected";
    }

    const iconCn =
        Icon === Loader2 ? "animate-spin text-muted-foreground" : "";

    const showRetry =
        authLost ||
        connectionState === "offline" ||
        connectionState === "reconnecting";

    return (
        <div
            className={cn(
                "flex flex-wrap items-center gap-3 border-b px-4 py-2 text-sm",
                tone === "danger" && "border-destructive/40 bg-destructive/10",
                tone === "warn" &&
                    !authLost &&
                    "border-amber-500/30 bg-amber-500/10",
                tone === "muted" && "bg-muted/50",
            )}
        >
            <div className="flex min-w-0 flex-1 items-center gap-2">
                <Icon className={cn("size-4 shrink-0", iconCn)} />
                <span className="font-medium">{headline}</span>
                {detail ? (
                    <span
                        className="text-muted-foreground truncate font-normal"
                        title={detail}
                    >
                        · {detail}
                    </span>
                ) : null}
            </div>
            {showRetry ? (
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={onReconnect}
                >
                    Retry connection
                </Button>
            ) : null}
        </div>
    );
}
