import { useEffect, useRef } from "react";

import { Mic, MicOff, PhoneOff, Video, VideoOff } from "lucide-react";

import { Button } from "@shared/shadcn/ui/button";
import { cn } from "@shared/lib/utils";

import type { PslackActiveCall } from "@/apps/chat/hooks/use-chat-socket";
import type { GroupMeetParticipantStatus } from "@/apps/chat/lib/group-meet-ui-state";

type Props = {
    call: PslackActiveCall;
    onEnd: () => void;
    localStream: MediaStream | null;
    remoteStream: MediaStream | null;
    remoteStreamsByAccount?: Readonly<Record<string, MediaStream | null>>;
    audioMuted: boolean;
    videoMuted: boolean;
    remoteAudioMuted: boolean;
    remoteVideoMuted: boolean;
    remoteAvStateByAccount?: Readonly<
        Record<string, { audioMuted?: boolean; videoMuted?: boolean }>
    >;
    audioOnlyFallback: boolean;
    onToggleAudio: () => void;
    onToggleVideo: () => void;
};

type ParticipantVideoTileProps = {
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

function participantStatusLabel(status: GroupMeetParticipantStatus): string {
    switch (status) {
        case "joined":
            return "Joined";
        case "ringing":
            return "Ringing";
        case "offline":
            return "Offline";
    }
}

function ParticipantVideoTile({
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

export function CallView({
    call,
    onEnd,
    localStream,
    remoteStream,
    remoteStreamsByAccount,
    audioMuted,
    videoMuted,
    remoteAudioMuted,
    remoteVideoMuted,
    remoteAvStateByAccount,
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
        call.source === "mock"
            ? "Mock Meet preview"
            : call.source === "av-call"
              ? "Meet (av-call)"
              : "Meet (WebRTC)";
    const statusLabel =
        call.status === "ringing"
            ? "Ringing"
            : call.status === "connected"
              ? "Connected"
              : "Ended";

    /** Outbound ringing cancel, or purely local mock preview → Cancel label. */
    const endButtonUseCancelLabel =
        (call.status === "ringing" && call.direction === "outgoing") ||
        call.source === "mock";

    const isGroupMeet =
        call.callKind === "group" &&
        (call.groupParticipants?.length ?? 0) > 0;

    const showMedia =
        call.source === "av-call" &&
        (call.status === "connected" ||
            (isGroupMeet &&
                remoteStreamsByAccount != null &&
                Object.values(remoteStreamsByAccount).some(
                    (stream) => stream != null,
                )));

    const showGroupGrid =
        isGroupMeet &&
        showMedia &&
        remoteStreamsByAccount != null;

    const participantStatusLabel = (
        status: NonNullable<typeof call.groupParticipants>[number]["status"],
    ): string => {
        switch (status) {
            case "joined":
                return "Joined";
            case "ringing":
                return "Ringing";
            case "offline":
                return "Offline";
        }
    };

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
        !showGroupGrid &&
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

    const groupTileCount =
        (call.groupParticipants?.length ?? 0) + (showGroupGrid ? 1 : 0);

    const controlBar = (
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
                aria-label={
                    endButtonUseCancelLabel ? "Cancel call" : "Leave call"
                }
            >
                <PhoneOff className="size-4" />
                {endButtonUseCancelLabel ? "Cancel" : "Leave"}
            </Button>
        </div>
    );

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
                            {isGroupMeet ? (
                                <>
                                    Group Meet ·{" "}
                                    <span className="font-medium text-foreground">
                                        {call.peerAccount}
                                    </span>
                                </>
                            ) : (
                                <>
                                    {call.direction === "incoming"
                                        ? "Incoming from"
                                        : "Calling"}{" "}
                                    <span className="font-medium text-foreground">
                                        {call.peerAccount}
                                    </span>
                                </>
                            )}
                        </p>
                        {isGroupMeet && !showGroupGrid ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {call.groupParticipants!.map((participant) => (
                                    <span
                                        key={participant.account}
                                        className={cn(
                                            "rounded-full px-2 py-0.5 text-xs font-medium",
                                            participant.status === "joined"
                                                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                                : participant.status ===
                                                    "ringing"
                                                  ? "bg-amber-500/15 text-amber-800 dark:text-amber-200"
                                                  : "bg-muted text-muted-foreground",
                                        )}
                                    >
                                        {participant.account} ·{" "}
                                        {participantStatusLabel(
                                            participant.status,
                                        )}
                                    </span>
                                ))}
                            </div>
                        ) : null}
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
                            <Button
                                type="button"
                                variant="outline"
                                onClick={onEnd}
                                aria-label={
                                    endButtonUseCancelLabel
                                        ? "Cancel call"
                                        : "Leave call"
                                }
                            >
                                <PhoneOff className="size-4" />
                                {endButtonUseCancelLabel ? "Cancel" : "Leave"}
                            </Button>
                        ) : null}
                    </div>
                </div>

                {showMedia && showGroupGrid ? (
                    <div className="relative mt-4 overflow-hidden rounded-lg bg-black">
                        <div
                            className={cn(
                                "grid gap-2 p-2",
                                groupTileCount <= 2
                                    ? "grid-cols-1 sm:grid-cols-2"
                                    : groupTileCount <= 4
                                      ? "grid-cols-2"
                                      : "grid-cols-2 lg:grid-cols-3",
                            )}
                        >
                            <ParticipantVideoTile
                                account="You"
                                stream={localStream}
                                isSelf
                                videoMuted={videoMuted}
                                audioOnlyFallback={audioOnlyFallback}
                                wantVideo={call.wantVideo}
                            />
                            {call.groupParticipants!.map((participant) => {
                                const remoteState =
                                    remoteAvStateByAccount?.[participant.account];
                                return (
                                    <ParticipantVideoTile
                                        key={participant.account}
                                        account={participant.account}
                                        stream={
                                            remoteStreamsByAccount[
                                                participant.account
                                            ] ?? null
                                        }
                                        status={participant.status}
                                        audioOnlyFallback={audioOnlyFallback}
                                        wantVideo={call.wantVideo}
                                        remoteAudioMuted={
                                            remoteState?.audioMuted ?? false
                                        }
                                        remoteVideoMuted={
                                            remoteState?.videoMuted ?? false
                                        }
                                    />
                                );
                            })}
                        </div>
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />
                        {controlBar}
                    </div>
                ) : null}

                {showMedia && !showGroupGrid ? (
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

                        {remoteVideoMuted ? (
                            <div
                                className="absolute left-3 top-14 inline-flex size-8 items-center justify-center rounded-full bg-black/70 text-white shadow-md ring-1 ring-white/15"
                                aria-label="Peer camera off"
                            >
                                <VideoOff className="size-3.5" />
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
                        {controlBar}
                    </div>
                ) : null}
            </div>
        </section>
    );
}
