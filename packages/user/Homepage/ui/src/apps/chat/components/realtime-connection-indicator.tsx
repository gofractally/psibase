import { Loader2, Wifi, WifiOff } from "lucide-react";

import type { RealtimeConnectionState } from "../lib/realtime-client";
import { cn } from "@shared/lib/utils";

type Props = {
    connectionState: RealtimeConnectionState;
    presenceReady: boolean;
    className?: string;
};

/** Compact header pill: connected / reconnecting / offline. */
export function RealtimeConnectionIndicator({
    connectionState,
    presenceReady,
    className,
}: Props) {
    const label =
        connectionState === "offline"
            ? "Offline"
            : connectionState === "reconnecting" || !presenceReady
              ? "Reconnecting"
              : "Connected";

    const Icon =
        connectionState === "offline"
            ? WifiOff
            : connectionState === "reconnecting" || !presenceReady
              ? Loader2
              : Wifi;

    const tone =
        connectionState === "connected" && presenceReady
            ? "text-emerald-600 dark:text-emerald-400"
            : connectionState === "offline"
              ? "text-muted-foreground"
              : "text-amber-600 dark:text-amber-400";

    return (
        <span
            className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
                tone,
                className,
            )}
            title={`Realtime: ${label}`}
        >
            <Icon
                className={cn(
                    "size-3 shrink-0",
                    Icon === Loader2 && "animate-spin",
                )}
            />
            {label}
        </span>
    );
}
