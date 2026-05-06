import { Button } from "@shared/shadcn/ui/button";
import { AlertTriangle, Loader2, WifiOff } from "lucide-react";

import type { PslackWsPublicState } from "../lib/ws-client";
import { cn } from "@shared/lib/utils";

type Props = {
    wsState: PslackWsPublicState;
    lastWsError: string | null;
    lastInboundError: string | null;
    authLost: boolean;
    syncedOnce: boolean;
    onReconnect: () => void;
};

/**
 * Thin status strip for websocket lifecycle: loading, synced, reconnecting, auth/session loss.
 */
export function ConnectionStatusBanner({
    wsState,
    lastWsError,
    lastInboundError,
    authLost,
    syncedOnce,
    onReconnect,
}: Props) {
    const showNeutralLoad =
        !syncedOnce && (wsState === "idle" || wsState === "connecting");

    /** After first snapshot, transitional transport states are reconnects, not initial load. */
    const showReconnecting =
        syncedOnce &&
        (wsState === "reconnecting" || wsState === "connecting");

    const showClosed = wsState === "closed" && syncedOnce;

    if (syncedOnce && wsState === "synced" && !authLost && !lastInboundError) {
        return null;
    }

    const detail = lastInboundError || lastWsError || "";

    let tone: "default" | "warn" | "danger" | "muted" = "muted";
    let Icon = Loader2;
    let headline = "";

    if (authLost) {
        tone = "danger";
        Icon = AlertTriangle;
        headline = "Sign-in expired or blocked";
    } else if (lastInboundError) {
        tone = "warn";
        Icon = AlertTriangle;
        headline = "Chat action failed";
    } else if (showNeutralLoad || !syncedOnce) {
        tone = "muted";
        Icon = Loader2;
        headline = "Connecting to chat…";
    } else if (showClosed) {
        tone = "warn";
        Icon = WifiOff;
        headline = "Disconnected";
    } else if (showReconnecting || wsState !== "synced") {
        tone = "warn";
        Icon = Loader2;
        headline = "Reconnecting…";
    }

    const iconCn =
        Icon === Loader2 ? "animate-spin text-muted-foreground" : "";

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
            {(authLost || showClosed || showReconnecting) && (
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={onReconnect}
                >
                    Retry connection
                </Button>
            )}
        </div>
    );
}
