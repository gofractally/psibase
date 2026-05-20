import { PhoneCall, PhoneOff } from "lucide-react";
import { useEffect, useState } from "react";

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

export function IncomingCallDialog({ call, onAccept, onDecline }: Props) {
    const [remaining, setRemaining] = useState(RING_SECONDS);

    useEffect(() => {
        if (!call) {
            setRemaining(RING_SECONDS);
            return;
        }
        setRemaining(RING_SECONDS);
        const started = Date.now();
        let finished = false;
        const id = globalThis.setInterval(() => {
            if (finished) return;
            const left = RING_SECONDS - Math.floor((Date.now() - started) / 1000);
            setRemaining(Math.max(0, left));
            if (left <= 0) {
                finished = true;
                globalThis.clearInterval(id);
                onDecline("timeout");
            }
        }, 250);
        return () => {
            finished = true;
            globalThis.clearInterval(id);
        };
    }, [call?.callId, call, onDecline]);

    return (
        <Dialog
            open={call !== null}
            onOpenChange={(open) => {
                if (!open) onDecline("user");
            }}
        >
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>Incoming Meet call</DialogTitle>
                    <DialogDescription>
                        {call ? (
                            <>
                                <span className="font-medium text-foreground">
                                    {call.from}
                                </span>{" "}
                                        is calling (signaling + WebRTC after you
                                        answer).
                            </>
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
                    <Button type="button" onClick={onAccept}>
                        <PhoneCall className="size-4" />
                        Accept
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
