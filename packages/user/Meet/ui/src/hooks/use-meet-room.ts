import { useCallback, useEffect, useRef, useState } from "react";
import { joinRoom, selfId } from "trystero";
import type { Room } from "trystero";

import { TRYSTERO_APP_ID } from "@/lib/config";

export type RemotePeer = {
    id: string;
    name: string;
    stream: MediaStream | null;
};

export const useMeetRoom = (
    roomId: string,
    displayName: string,
    password?: string | null,
) => {
    const nameRef = useRef(displayName);
    nameRef.current = displayName;

    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [peers, setPeers] = useState<Record<string, RemotePeer>>({});
    const [error, setError] = useState<string | null>(null);
    const [isConnecting, setIsConnecting] = useState(true);
    const [micOn, setMicOn] = useState(true);
    const [camOn, setCamOn] = useState(true);

    const sendNameRef = useRef<((name: string, target?: string) => void) | null>(
        null,
    );

    useEffect(() => {
        sendNameRef.current?.(displayName);
    }, [displayName]);

    useEffect(() => {
        let cancelled = false;
        let room: Room | undefined;
        let stream: MediaStream | undefined;

        const upsertPeer = (id: string, patch: Partial<RemotePeer>) => {
            setPeers((current) => ({
                ...current,
                [id]: {
                    id,
                    name: current[id]?.name ?? `Guest ${id.slice(0, 4)}`,
                    stream: current[id]?.stream ?? null,
                    ...patch,
                },
            }));
        };

        if (!roomId || password === null) {
            setIsConnecting(Boolean(roomId));
            return;
        }

        const start = async () => {
            setError(null);
            setIsConnecting(true);
            setPeers({});

            if (!navigator.mediaDevices?.getUserMedia) {
                if (!cancelled) {
                    setError(
                        "Camera and microphone need a secure origin (https or localhost).",
                    );
                    setIsConnecting(false);
                }
                return;
            }

            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: true,
                    video: true,
                });
            } catch {
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        audio: true,
                        video: false,
                    });
                    setCamOn(false);
                } catch (mediaError) {
                    const message =
                        mediaError instanceof Error
                            ? mediaError.message
                            : "Could not access camera or microphone";
                    if (!cancelled) {
                        setError(message);
                        setIsConnecting(false);
                    }
                    return;
                }
            }

            if (cancelled) {
                stream.getTracks().forEach((track) => track.stop());
                return;
            }

            setLocalStream(stream);

            room = joinRoom(
                {
                    appId: TRYSTERO_APP_ID,
                    ...(password ? { password } : {}),
                },
                roomId,
                {
                    onJoinError: ({ error: joinError }) => {
                        setError(joinError);
                    },
                },
            );

            const nameAction = room.makeAction<string>("peerName");
            sendNameRef.current = (name, target) => {
                void nameAction.send(name, target ? { target } : undefined);
            };
            nameAction.onMessage = (name, { peerId }) => {
                upsertPeer(peerId, { name });
            };

            void room.addStream(stream);
            void nameAction.send(nameRef.current);

            room.onPeerJoin = (peerId) => {
                upsertPeer(peerId, {});
                if (stream) {
                    void room?.addStream(stream, { target: peerId });
                }
                void nameAction.send(nameRef.current, { target: peerId });
            };

            room.onPeerLeave = (peerId) => {
                setPeers((current) => {
                    const next = { ...current };
                    delete next[peerId];
                    return next;
                });
            };

            room.onPeerStream = (remoteStream, peerId) => {
                upsertPeer(peerId, { stream: remoteStream });
            };

            if (!cancelled) {
                setIsConnecting(false);
            }
        };

        void start();

        return () => {
            cancelled = true;
            sendNameRef.current = null;
            void room?.leave();
            stream?.getTracks().forEach((track) => track.stop());
            setLocalStream(null);
            setPeers({});
        };
    }, [roomId, password]);

    const setMicEnabled = useCallback((enabled: boolean) => {
        setMicOn(enabled);
        localStream
            ?.getAudioTracks()
            .forEach((track) => {
                track.enabled = enabled;
            });
    }, [localStream]);

    const setCamEnabled = useCallback((enabled: boolean) => {
        setCamOn(enabled);
        localStream
            ?.getVideoTracks()
            .forEach((track) => {
                track.enabled = enabled;
            });
    }, [localStream]);

    return {
        selfId,
        localStream,
        peers: Object.values(peers),
        error,
        isConnecting,
        micOn,
        camOn,
        setMicEnabled,
        setCamEnabled,
    };
};
