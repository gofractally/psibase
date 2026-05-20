import { useEffect, useRef } from "react";

import { Mic, MicOff, PhoneOff, Video, VideoOff } from "lucide-react";

import { Button } from "@shared/shadcn/ui/button";
import { cn } from "@shared/lib/utils";

import type { PslackActiveCall } from "@/apps/chat/hooks/use-chat-socket";

type Props = {
    call: PslackActiveCall;
    onEnd: () => void;
    localStream: MediaStream | null;
    remoteStream: MediaStream | null;
    audioMuted: boolean;
    videoMuted: boolean;
    remoteAudioMuted: boolean;
    remoteVideoMuted: boolean;
    audioOnlyFallback: boolean;
    onToggleAudio: () => void;
    onToggleVideo: () => void;
};

export function CallView({
    call,
    onEnd,
    localStream,
    remoteStream,
    audioMuted,
    videoMuted,
    remoteAudioMuted,
    remoteVideoMuted,
    audioOnlyFallback,
    onToggleAudio,
    onToggleVideo,
}: Props) {
    const remoteRef = useRef<HTMLVideoElement>(null);
    const localRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        const el = remoteRef.current;
        if (!el) return;
        el.srcObject = remoteStream;
        return () => {
            el.srcObject = null;
        };
    }, [remoteStream, remoteVideoMuted, call.status]);

    useEffect(() => {
        const el = localRef.current;
        if (!el) return;
        el.srcObject = localStream;
        return () => {
            el.srcObject = null;
        };
    }, [localStream, videoMuted]);

    const sourceLabel =
        call.source === "mock" ? "Mock Meet preview" : "Meet (WebRTC)";
    const statusLabel =
        call.status === "ringing"
            ? "Ringing"
            : call.status === "connected"
              ? "Connected"
              : "Ended";

    const showMedia =
        call.source === "service-frame" && call.status === "connected";

    /** Outbound ringing cancel, or purely local mock preview → Cancel label. */
    const endButtonUseCancelLabel =
        (call.status === "ringing" && call.direction === "outgoing") ||
        call.source === "mock";

    const remoteVideoTrack = remoteStream?.getVideoTracks()[0];
    const remoteVideoLive =
        !!remoteVideoTrack && remoteVideoTrack.readyState === "live";
    const remoteVideoShows =
        remoteVideoLive &&
        remoteVideoTrack.enabled !== false &&
        !remoteVideoMuted &&
        !audioOnlyFallback &&
        call.wantVideo;

    const localVideoTrack = localStream?.getVideoTracks()[0];
    const localVideoLive =
        !!localVideoTrack && localVideoTrack.readyState === "live";
    const showLocalPip =
        showMedia &&
        localVideoLive &&
        !videoMuted &&
        !audioOnlyFallback &&
        call.wantVideo;

    const remoteSecondaryLabel =
        audioOnlyFallback || !call.wantVideo
            ? "Audio only — remote"
            : remoteVideoMuted
              ? "Peer camera off"
            : !remoteVideoLive
              ? "Waiting for peer video…"
              : remoteVideoTrack && !remoteVideoTrack.enabled
                ? "Peer camera off"
                : null;

    return (
        <section className="border-b bg-muted/30 px-4 py-3">
            <div className="rounded-xl border bg-background p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold">
                                {sourceLabel}
                            </span>
                            <span
                                className={cn(
                                    "rounded-full px-2 py-0.5 text-xs font-medium",
                                    call.status === "ended"
                                        ? "bg-muted text-muted-foreground"
                                        : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                                )}
                            >
                                {statusLabel}
                            </span>
                            {showMedia && audioOnlyFallback ? (
                                <span className="bg-amber-500/15 text-amber-800 dark:text-amber-200 rounded-full px-2 py-0.5 text-xs font-medium">
                                    Audio only
                                </span>
                            ) : null}
                        </div>
                        <p className="text-muted-foreground text-sm">
                            {call.direction === "incoming"
                                ? "Incoming from"
                                : "Calling"}{" "}
                            <span className="font-medium text-foreground">
                                {call.peerAccount}
                            </span>
                        </p>
                        {call.lastFrame ? (
                            <p className="text-muted-foreground text-xs">
                                {call.lastFrame}
                            </p>
                        ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {!showMedia ? (
                            <>
                                {call.wantAudio ? (
                                    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs">
                                        <Mic className="size-3.5" />
                                        Audio
                                    </span>
                                ) : null}
                                {call.wantVideo ? (
                                    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs">
                                        <Video className="size-3.5" />
                                        Video
                                    </span>
                                ) : null}
                            </>
                        ) : null}
                        {!showMedia ? (
                            <Button type="button" variant="outline" onClick={onEnd}>
                                <PhoneOff className="size-4" />
                                {endButtonUseCancelLabel ? "Cancel" : "End"}
                            </Button>
                        ) : null}
                    </div>
                </div>

                {showMedia ? (
                    <div className="relative mt-4 aspect-video w-full max-h-[min(56vh,520px)] overflow-hidden rounded-lg bg-black">
                        {remoteVideoShows ? (
                            <video
                                ref={remoteRef}
                                className="size-full object-cover"
                                autoPlay
                                playsInline
                            />
                        ) : (
                            <div className="text-muted-foreground flex size-full flex-col items-center justify-center gap-2 bg-gradient-to-b from-zinc-900 to-zinc-950 px-4 text-center text-sm">
                                <span className="text-lg font-medium text-white/90">
                                    {call.peerAccount}
                                </span>
                                <span className="text-white/70">
                                    {remoteSecondaryLabel ?? "Connecting…"}
                                </span>
                            </div>
                        )}

                        {remoteAudioMuted ? (
                            <div
                                className="absolute left-3 top-3 inline-flex size-8 items-center justify-center rounded-full bg-black/70 text-white shadow-md ring-1 ring-white/15"
                                aria-label="Peer microphone muted"
                            >
                                <MicOff className="size-3.5" />
                            </div>
                        ) : null}

                        {showLocalPip ? (
                            <div className="absolute bottom-16 right-3 w-[30%] min-w-[128px] max-w-[220px] overflow-hidden rounded-lg border-2 border-white/30 shadow-xl ring-1 ring-black/40">
                                <div className="bg-black/60 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-white/90">
                                    You
                                </div>
                                <video
                                    ref={localRef}
                                    className="aspect-video w-full object-cover"
                                    autoPlay
                                    playsInline
                                    muted
                                />
                            </div>
                        ) : showMedia &&
                          call.wantVideo &&
                          !audioOnlyFallback ? (
                            <div className="absolute bottom-16 right-3 w-[30%] min-w-[128px] max-w-[220px] overflow-hidden rounded-lg border border-white/25 bg-black/55 p-3 text-center text-xs text-white/85 shadow-lg">
                                <p className="font-medium">You</p>
                                <p className="text-white/70">
                                    {videoMuted
                                        ? "Camera off"
                                        : "Starting camera…"}
                                </p>
                            </div>
                        ) : null}

                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />
                        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-2 p-3">
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="pointer-events-auto shadow-md"
                                onClick={onToggleAudio}
                                aria-pressed={audioMuted}
                                aria-label={
                                    audioMuted ? "Unmute microphone" : "Mute microphone"
                                }
                            >
                                {audioMuted ? (
                                    <MicOff className="size-4" />
                                ) : (
                                    <Mic className="size-4" />
                                )}
                            </Button>
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="pointer-events-auto shadow-md"
                                onClick={onToggleVideo}
                                disabled={audioOnlyFallback || !call.wantVideo}
                                aria-pressed={videoMuted}
                                aria-label={
                                    videoMuted ? "Turn camera on" : "Turn camera off"
                                }
                            >
                                {videoMuted || audioOnlyFallback ? (
                                    <VideoOff className="size-4" />
                                ) : (
                                    <Video className="size-4" />
                                )}
                            </Button>
                            <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                className="pointer-events-auto shadow-md"
                                onClick={onEnd}
                                aria-label={endButtonUseCancelLabel ? "Cancel call" : "End call"}
                            >
                                <PhoneOff className="size-4" />
                                {endButtonUseCancelLabel ? "Cancel" : "End"}
                            </Button>
                        </div>
                    </div>
                ) : null}
            </div>
        </section>
    );
}
