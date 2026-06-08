import { KeyboardEvent, useEffect, useRef, useState } from "react";

import { Button } from "@shared/shadcn/ui/button";
import { Textarea } from "@shared/shadcn/ui/textarea";

type Props = {
    disabledReason: string | null;
    onSend: (body: string) => void;
    /** Changes when the active thread changes — refocus the composer when enabled. */
    focusKey?: string;
};

export function ChatComposer({ disabledReason, onSend, focusKey }: Props) {
    const [value, setValue] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const disabled = disabledReason !== null;

    useEffect(() => {
        if (disabled) return;
        textareaRef.current?.focus({ preventScroll: true });
    }, [disabled, focusKey]);

    const submit = () => {
        if (disabled) return;
        onSend(value);
        setValue("");
    };

    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
        }
    };

    return (
        <div className="bg-background/80 border-t p-3 backdrop-blur">
            {disabled && disabledReason ? (
                <p className="text-muted-foreground mb-2 text-xs">
                    {disabledReason}
                </p>
            ) : null}

            <div className="flex items-end gap-2">
                <Textarea
                    ref={textareaRef}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="Message…"
                    disabled={disabled}
                    rows={2}
                    className="min-h-[44px] resize-none"
                    aria-label="Message text"
                />
                <Button
                    type="button"
                    onClick={submit}
                    disabled={disabled || !value.trim()}
                >
                    Send
                </Button>
            </div>
        </div>
    );
}
