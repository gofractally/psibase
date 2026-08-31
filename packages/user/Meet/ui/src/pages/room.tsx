import { Copy, Mic, MicOff, PhoneOff, Video, VideoOff } from "lucide-react";
import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { VideoTile } from "@/components/video-tile";
import { useMeetRoom } from "@/hooks/use-meet-room";
import { DISPLAY_NAME_KEY } from "@/lib/config";
import { ROOM_ID_PATTERN } from "@/lib/room-id";

import { PageContainer } from "@shared/components/page-container";
import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Button } from "@shared/shadcn/ui/button";
import { toast } from "@shared/shadcn/ui/sonner";
import { Spinner } from "@shared/shadcn/ui/spinner";

export const Room = () => {
    const { roomId = "" } = useParams<{ roomId: string }>();
    const navigate = useNavigate();
    const { data: currentUser } = useCurrentUser();

    const displayName = useMemo(() => {
        const stored = sessionStorage.getItem(DISPLAY_NAME_KEY)?.trim();
        if (stored) return stored;
        if (typeof currentUser === "string") return currentUser;
        return "Guest";
    }, [currentUser]);

    const isValidRoom = ROOM_ID_PATTERN.test(roomId);
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
    } = useMeetRoom(isValidRoom ? roomId : "", displayName);

    if (!isValidRoom) {
        return (
            <PageContainer>
                <p className="text-muted-foreground text-sm">
                    That room name is not valid.
                </p>
                <Button className="mt-4" onClick={() => navigate("/")}>
                    Back
                </Button>
            </PageContainer>
        );
    }

    const copyLink = async () => {
        try {
            await navigator.clipboard.writeText(window.location.href);
            toast.success("Room link copied");
        } catch {
            toast.error("Could not copy link");
        }
    };

    const localName = `${displayName} (you)`;
    const participantCount = peers.length + 1;

    return (
        <PageContainer className="flex max-w-6xl flex-1 flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-lg font-semibold">Room {roomId}</h1>
                    <p className="text-muted-foreground text-sm">
                        {participantCount}{" "}
                        {participantCount === 1 ? "person" : "people"} · open to
                        anyone with the link
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void copyLink()}>
                    <Copy />
                    Copy link
                </Button>
            </div>

            {error ? (
                <p className="text-destructive text-sm">{error}</p>
            ) : null}

            {isConnecting ? (
                <div className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Spinner />
                    Connecting…
                </div>
            ) : null}

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
                    aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
                >
                    {micOn ? <Mic /> : <MicOff />}
                </Button>
                <Button
                    size="icon"
                    variant={camOn ? "outline" : "destructive"}
                    onClick={() => setCamEnabled(!camOn)}
                    aria-label={camOn ? "Turn camera off" : "Turn camera on"}
                    disabled={!localStream?.getVideoTracks().length}
                >
                    {camOn ? <Video /> : <VideoOff />}
                </Button>
                <Button
                    variant="destructive"
                    onClick={() => navigate("/")}
                >
                    <PhoneOff />
                    Leave
                </Button>
            </div>
            <p className="text-muted-foreground text-center text-xs">
                Peer {selfId.slice(0, 8)}
            </p>
        </PageContainer>
    );
};
