import { Copy, Mic, MicOff, PhoneOff, Video, VideoOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { VideoTile } from "@/components/video-tile";
import { useMeetRoom } from "@/hooks/use-meet-room";
import { meetPlugin } from "@/hooks/use-plugin";
import { DISPLAY_NAME_KEY } from "@/lib/config";
import { getMeeting, getMeetingMembers } from "@/lib/graphql";
import {
    loadMeetingPassword,
    storeMeetingPassword,
} from "@/lib/meeting-password";

import { PageContainer } from "@shared/components/page-container";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { zAccount } from "@shared/lib/schemas/account";
import { Button } from "@shared/shadcn/ui/button";
import { toast } from "@shared/shadcn/ui/sonner";
import { Spinner } from "@shared/shadcn/ui/spinner";

export const PrivateRoom = () => {
    const { meetingId: meetingIdParam } = useParams<{ meetingId: string }>();
    const meetingId = (meetingIdParam ?? "").toLowerCase();
    const isValidMeetingId = zAccount.safeParse(meetingId).success;
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { data: currentUser } = useCurrentUser();

    const displayName = useMemo(() => {
        const stored = sessionStorage.getItem(DISPLAY_NAME_KEY)?.trim();
        if (stored) return stored;
        if (typeof currentUser === "string") return currentUser;
        return "Guest";
    }, [currentUser]);

    const meetingQuery = useQuery({
        queryKey: ["meet", "meeting", meetingId],
        enabled: isValidMeetingId,
        queryFn: () => getMeeting(meetingId),
        refetchInterval: 4000,
    });

    const membersQuery = useQuery({
        queryKey: ["meet", "members", meetingId],
        enabled: isValidMeetingId,
        queryFn: () => getMeetingMembers(meetingId),
        refetchInterval: 4000,
    });

    const [password, setPassword] = useState<string | null>(null);
    const [passwordError, setPasswordError] = useState<string | null>(null);

    const members = membersQuery.data ?? [];
    const myWrapReady =
        typeof currentUser === "string"
            ? Boolean(
                  members.find((member) => member.account === currentUser)
                      ?.wrapReady,
              )
            : false;
    const missingWraps = members.filter((member) => !member.wrapReady);
    const keyHash = meetingQuery.data?.keyHash;

    useEffect(() => {
        if (typeof currentUser !== "string") return;
        let cancelled = false;
        const cached = loadMeetingPassword(meetingId, keyHash);
        if (cached) {
            setPassword(cached);
            setPasswordError(null);
        } else {
            setPassword(null);
            setPasswordError(null);
        }
        meetPlugin
            .meetingPassword(meetingId)
            .then((value) => {
                if (cancelled) return;
                setPassword(value);
                setPasswordError(null);
                if (keyHash) storeMeetingPassword(meetingId, keyHash, value);
            })
            .catch((error: Error) => {
                if (cancelled) return;
                if (!cached) {
                    setPassword(null);
                    setPasswordError(error.message);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [currentUser, meetingId, keyHash, myWrapReady]);

    const {
        localStream,
        peers,
        error,
        isConnecting,
        micOn,
        camOn,
        setMicEnabled,
        setCamEnabled,
        selfId,
    } = useMeetRoom(
        isValidMeetingId ? `private-${meetingId}` : "",
        displayName,
        password,
    );

    const canWrap = Boolean(password);

    const publishKey = useMutation({
        mutationFn: () => meetPlugin.setKey(),
        onSuccess: () => toast.success("Meeting key published"),
        onError: (error: Error) => toast.error(error.message),
    });

    const wrapMember = async (account: string) => {
        try {
            await meetPlugin.wrapMember(meetingId, account);
            toast.success(`Published key for ${account}`);
            await queryClient.invalidateQueries({
                queryKey: ["meet", "members", meetingId],
            });
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : "Could not publish wrap",
            );
        }
    };

    const isHost =
        typeof currentUser === "string" &&
        currentUser === meetingQuery.data?.host;

    const deleteMeeting = useMutation({
        mutationFn: () => meetPlugin.deleteMeeting(meetingId),
        onSuccess: () => {
            toast.success("Meeting deleted");
            void queryClient.invalidateQueries({ queryKey: ["meet"] });
            navigate("/");
        },
        onError: (error: Error) => toast.error(error.message),
    });

    const copyLink = async () => {
        try {
            await navigator.clipboard.writeText(window.location.href);
            toast.success("Private room link copied");
        } catch {
            toast.error("Could not copy link");
        }
    };

    if (!isValidMeetingId) {
        return (
            <PageContainer>
                <p className="text-muted-foreground text-sm">Invalid meeting.</p>
                <Button className="mt-4" onClick={() => navigate("/")}>
                    Back
                </Button>
            </PageContainer>
        );
    }

    const waitingForKey = !password;
    const localName = `${displayName} (you)`;
    const participantCount = peers.length + (password ? 1 : 0);

    return (
        <PageContainer className="flex max-w-6xl flex-1 flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-lg font-semibold">
                        Private meeting {meetingId}
                    </h1>
                    <p className="text-muted-foreground text-sm">
                        Host {meetingQuery.data?.host ?? "…"} · whitelist only
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void copyLink()}
                    >
                        <Copy />
                        Copy link
                    </Button>
                    {isHost ? (
                        <Button
                            variant="destructive"
                            size="sm"
                            disabled={deleteMeeting.isPending}
                            onClick={() => deleteMeeting.mutate()}
                        >
                            {deleteMeeting.isPending ? "Deleting…" : "Delete"}
                        </Button>
                    ) : null}
                </div>
            </div>

            {typeof currentUser !== "string" ? (
                <p className="text-muted-foreground text-sm">
                    Log in to join this private meeting.
                </p>
            ) : null}

            {waitingForKey && typeof currentUser === "string" ? (
                <div className="space-y-2">
                    <p className="text-muted-foreground text-sm">
                        {passwordError ??
                            "Waiting for a whitelist member to publish your meeting key."}
                    </p>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={publishKey.isPending}
                        onClick={() => publishKey.mutate()}
                    >
                        {publishKey.isPending
                            ? "Publishing…"
                            : "Publish my meeting key"}
                    </Button>
                </div>
            ) : null}

            {error ? <p className="text-destructive text-sm">{error}</p> : null}

            {isConnecting && password ? (
                <div className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Spinner />
                    Connecting…
                </div>
            ) : null}

            {canWrap && missingWraps.length > 0 ? (
                <div className="space-y-2">
                    <p className="text-sm font-medium">Waiting for keys</p>
                    {missingWraps.map((member) => (
                        <div
                            key={member.account}
                            className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                        >
                            <span>{member.account}</span>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void wrapMember(member.account)}
                            >
                                Publish key
                            </Button>
                        </div>
                    ))}
                </div>
            ) : null}

            {password ? (
                <>
                    <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <VideoTile
                            name={localName}
                            stream={localStream}
                            muted
                            mirrored
                            cameraOff={!camOn}
                        />
                        {peers.map((peer) => (
                            <VideoTile
                                key={peer.id}
                                name={peer.name}
                                stream={peer.stream}
                            />
                        ))}
                    </div>
                    <div className="bg-background/80 sticky bottom-4 mx-auto flex items-center gap-2 rounded-full border px-3 py-2 shadow-sm">
                        <Button
                            size="icon"
                            variant={micOn ? "outline" : "destructive"}
                            onClick={() => setMicEnabled(!micOn)}
                            aria-label={
                                micOn ? "Mute microphone" : "Unmute microphone"
                            }
                        >
                            {micOn ? <Mic /> : <MicOff />}
                        </Button>
                        <Button
                            size="icon"
                            variant={camOn ? "outline" : "destructive"}
                            onClick={() => setCamEnabled(!camOn)}
                            aria-label={
                                camOn ? "Turn camera off" : "Turn camera on"
                            }
                            disabled={!localStream?.getVideoTracks().length}
                        >
                            {camOn ? <Video /> : <VideoOff />}
                        </Button>
                        <Button variant="destructive" onClick={() => navigate("/")}>
                            <PhoneOff />
                            Leave
                        </Button>
                    </div>
                    <p className="text-muted-foreground text-center text-xs">
                        {participantCount} connected · peer {selfId.slice(0, 8)}
                    </p>
                </>
            ) : null}
        </PageContainer>
    );
};
