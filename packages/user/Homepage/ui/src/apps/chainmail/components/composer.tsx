import { ArrowUp, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocalStorage } from "usehooks-ts";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Button } from "@shared/shadcn/ui/button";

import { deriveSubject } from "../hooks/use-conversations";

export interface OutgoingMessage {
    subject: string;
    body: string;
}

interface Props {
    peer: string;
    placeholder: string;
    /** Resolves false if sending failed, so the text can be restored. */
    onSend: (message: OutgoingMessage) => Promise<boolean>;
}

/** Message box pinned to the bottom of a thread. Unsent text is kept per chat. */
export const Composer = ({ peer, placeholder, onSend }: Props) => {
    const { data: user } = useCurrentUser();
    const [draft, setDraft, removeDraft] = useLocalStorage(
        `chainmail:draft:${user ?? ""}:${peer}`,
        "",
    );
    const [subject, setSubject] = useState("");
    const [showSubject, setShowSubject] = useState(false);
    const textRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        textRef.current?.focus();
    }, []);

    const canSend = draft.trim().length > 0;

    const submit = async () => {
        const body = draft.trim();
        if (!body) return;
        const message = {
            body,
            subject: subject.trim() || deriveSubject(body),
        };
        const typedSubject = subject;
        removeDraft();
        setSubject("");
        setShowSubject(false);
        textRef.current?.focus();
        const ok = await onSend(message);
        if (!ok) {
            setDraft(body);
            if (typedSubject) {
                setSubject(typedSubject);
                setShowSubject(true);
            }
        }
    };

    return (
        <form
            className="bg-background/60 shrink-0 border-t px-3 py-3 backdrop-blur sm:px-6"
            onSubmit={(e) => {
                e.preventDefault();
                void submit();
            }}
        >
            <div className="bg-card focus-within:ring-ring/30 mx-auto flex max-w-3xl flex-col rounded-2xl border shadow-sm transition-shadow focus-within:ring-2">
                {showSubject && (
                    <input
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder="Subject (optional)"
                        aria-label="Subject"
                        maxLength={120}
                        className="placeholder:text-muted-foreground border-0 border-b bg-transparent px-4 py-2 text-sm font-medium shadow-none outline-none focus:outline-none focus:ring-0"
                    />
                )}
                <textarea
                    ref={textRef}
                    rows={1}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (
                            e.key === "Enter" &&
                            !e.shiftKey &&
                            !e.nativeEvent.isComposing
                        ) {
                            e.preventDefault();
                            void submit();
                        }
                    }}
                    placeholder={placeholder}
                    aria-label="Message"
                    className="field-sizing-content placeholder:text-muted-foreground max-h-48 min-h-11 w-full resize-none border-0 bg-transparent px-4 pt-3 text-sm leading-relaxed shadow-none outline-none focus:outline-none focus:ring-0"
                />
                <div className="flex items-center justify-between gap-2 px-2 pb-2">
                    <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="text-muted-foreground"
                        onClick={() => {
                            setShowSubject((s) => !s);
                            setSubject("");
                        }}
                    >
                        {showSubject ? (
                            <X className="size-3" />
                        ) : (
                            <Plus className="size-3" />
                        )}
                        {showSubject ? "Remove subject" : "Add subject"}
                    </Button>
                    <div className="flex items-center gap-2">
                        <span className="text-muted-foreground hidden text-[11px] sm:inline">
                            Enter to send · Shift+Enter for a new line
                        </span>
                        <Button
                            type="submit"
                            size="icon-sm"
                            disabled={!canSend}
                            aria-label="Send message"
                            className="hover:bg-[var(--brand)]/90 rounded-full bg-[var(--brand)] text-[var(--brand-foreground)]"
                        >
                            <ArrowUp className="size-4" />
                        </Button>
                    </div>
                </div>
            </div>
        </form>
    );
};
