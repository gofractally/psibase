import { PhoneCall, PhoneOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

import type { PslackIncomingCall } from "@/apps/chat/hooks/use-chat-socket";

type Props = {
    call: PslackIncomingCall | null;
    onAccept: () => void;
    /** User closed the dialog or pressed Decline, or the ring timer fired. */
    onDecline: (reason: "user" | "timeout") => void;
};

const RING_SECONDS = 20;
/** Group invites can sit open while other members connect first (e2e + real UX). */
const GROUP_RING_SECONDS = 180;

function ringSecondsForCall(call: PslackIncomingCall | null): number {
    if (call?.groupParticipantCount && call.groupParticipantCount > 2) {
        return GROUP_RING_SECONDS;
    }
    return RING_SECONDS;
}

export function IncomingCallDialog({ call, onAccept, onDecline }: Props) {
    const ringSeconds = ringSecondsForCall(call);
    const [remaining, setRemaining] = useState(ringSeconds);
    const acceptingRef = useRef(false);

    useEffect(() => {
        if (!call) {
            setRemaining(RING_SECONDS);
            return;
        }
        const seconds = ringSecondsForCall(call);
        setRemaining(seconds);
        const started = Date.now();
        let finished = false;
        const id = globalThis.setInterval(() => {
            if (finished) return;
            const left =
                seconds - Math.floor((Date.now() - started) / 1000);
            setRemaining(Math.max(0, left));
            if (left <= 0) {
                finished = true;
                globalThis.clearInterval(id);
                if (!acceptingRef.current) {
                    onDecline("timeout");
                }
            }
        }, 250);
        return () => {
            finished = true;
            globalThis.clearInterval(id);
        };
    }, [call?.callId, call, onDecline]);

    const handleAccept = () => {
        acceptingRef.current = true;
        onAccept();
    };

    return (
        <Dialog
            open={call !== null}
            onOpenChange={(open) => {
                if (!open) {
                    acceptingRef.current = false;
                }
            }}
        >
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>Incoming Meet call</DialogTitle>
                    <DialogDescription>
                        {call ? (
                            call.groupParticipantCount &&
                            call.groupParticipantCount > 2 ? (
                                <>
                                    <span className="font-medium text-foreground">
                                        {call.from}
                                    </span>{" "}
                                    is inviting you to a group Meet (
                                    {call.groupParticipantCount} members).
                                    Signaling and WebRTC mesh start after you
                                    answer.
                                </>
                            ) : (
                                <>
                                    <span className="font-medium text-foreground">
                                        {call.from}
                                    </span>{" "}
                                    is calling (signaling + WebRTC after you
                                    answer).
                                </>
                            )
                        ) : null}
                    </DialogDescription>
                </DialogHeader>

                {call ? (
                    <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                        <div className="font-medium">
                            {call.wantVideo ? "Video" : "Audio"} invitation
                        </div>
                        <div className="text-muted-foreground mt-1">
                            Answering automatically in {remaining}s…
                        </div>
                    </div>
                ) : null}

                <DialogFooter className="gap-2 sm:justify-between">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onDecline("user")}
                    >
                        <PhoneOff className="size-4" />
                        Decline
                    </Button>
                    <Button type="button" onClick={handleAccept}>
                        <PhoneCall className="size-4" />
                        Accept
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
