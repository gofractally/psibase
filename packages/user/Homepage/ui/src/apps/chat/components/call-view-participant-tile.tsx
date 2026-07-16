import { useEffect, useRef } from "react";

import { MicOff, VideoOff } from "lucide-react";

import { cn } from "@shared/lib/utils";

import type { GroupMeetParticipantStatus } from "@/apps/chat/lib/group-meet-ui-state";

/** A single group-Meet video tile (self or remote participant). See `CallView`. */

export type ParticipantVideoTileProps = {
    account: string;
    stream: MediaStream | null;
    status?: GroupMeetParticipantStatus;
    isSelf?: boolean;
    videoMuted?: boolean;
    audioOnlyFallback?: boolean;
    wantVideo?: boolean;
    remoteAudioMuted?: boolean;
    remoteVideoMuted?: boolean;
};

export function participantStatusLabel(
    status: GroupMeetParticipantStatus,
): string {
    switch (status) {
        case "joined":
            return "Joined";
        case "ringing":
            return "Ringing";
        case "offline":
            return "Offline";
    }
}

export function ParticipantVideoTile({
    account,
    stream,
    status = "joined",
    isSelf = false,
    videoMuted = false,
    audioOnlyFallback = false,
    wantVideo = true,
    remoteAudioMuted = false,
    remoteVideoMuted = false,
}: ParticipantVideoTileProps) {
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        const el = videoRef.current;
        if (!el) return;
        el.srcObject = stream;
        return () => {
            el.srcObject = null;
        };
    }, [stream]);

    const videoTrack = stream?.getVideoTracks()[0];
    const videoLive = !!videoTrack && videoTrack.readyState === "live";
    const mountVideo =
        !!stream &&
        wantVideo &&
        !audioOnlyFallback &&
        (isSelf ? !videoMuted : !remoteVideoMuted);
    const videoShows =
        mountVideo &&
        videoLive &&
        videoTrack.enabled !== false &&
        !(isSelf ? false : remoteVideoMuted);

    const secondaryLabel = isSelf
        ? videoMuted
            ? "Camera off"
            : !videoLive
              ? "Starting camera…"
              : null
        : status === "ringing"
          ? "Ringing…"
          : status === "offline"
            ? "Offline"
            : audioOnlyFallback || !wantVideo
              ? "Audio only"
              : remoteVideoMuted
                ? "Camera off"
                : !videoLive
                  ? "Waiting for video…"
                  : videoTrack && !videoTrack.enabled
                    ? "Camera off"
                    : null;

    return (
        <div className="relative aspect-video overflow-hidden rounded-lg bg-gradient-to-b from-zinc-900 to-zinc-950 ring-1 ring-white/10">
            {mountVideo ? (
                <>
                    <video
                        ref={videoRef}
                        className={cn(
                            "size-full object-cover",
                            !videoShows && "opacity-0",
                        )}
                        autoPlay
                        playsInline
                        muted={isSelf}
                    />
                    {!videoShows ? (
                        <div className="text-muted-foreground absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 text-center text-xs">
                            <span className="text-sm font-medium text-white/90">
                                {isSelf ? "You" : account}
                            </span>
                            <span className="text-white/70">
                                {secondaryLabel ?? "Connecting…"}
                            </span>
                        </div>
                    ) : null}
                </>
            ) : (
                <div className="text-muted-foreground flex size-full flex-col items-center justify-center gap-1.5 px-3 text-center text-xs">
                    <span className="text-sm font-medium text-white/90">
                        {isSelf ? "You" : account}
                    </span>
                    <span className="text-white/70">
                        {secondaryLabel ?? "Connecting…"}
                    </span>
                </div>
            )}

            <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/75 to-transparent px-2 py-1.5">
                <span className="truncate text-[11px] font-medium text-white/95">
                    {isSelf ? "You" : account}
                </span>
                {!isSelf ? (
                    <span
                        className={cn(
                            "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                            status === "joined"
                                ? "bg-emerald-500/25 text-emerald-100"
                                : status === "ringing"
                                  ? "bg-amber-500/25 text-amber-100"
                                  : "bg-white/15 text-white/70",
                        )}
                    >
                        {participantStatusLabel(status)}
                    </span>
                ) : null}
            </div>

            {!isSelf && remoteAudioMuted ? (
                <div
                    className="absolute bottom-2 left-2 inline-flex size-7 items-center justify-center rounded-full bg-black/70 text-white shadow-md ring-1 ring-white/15"
                    aria-label={`${account} microphone muted`}
                >
                    <MicOff className="size-3" />
                </div>
            ) : null}

            {!isSelf && remoteVideoMuted ? (
                <div
                    className="absolute bottom-2 right-2 inline-flex size-7 items-center justify-center rounded-full bg-black/70 text-white shadow-md ring-1 ring-white/15"
                    aria-label={`${account} camera off`}
                >
                    <VideoOff className="size-3" />
                </div>
            ) : null}
        </div>
    );
}
