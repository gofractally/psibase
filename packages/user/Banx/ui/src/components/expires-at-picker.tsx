import { useEffect, useMemo, useState } from "react";

import { CalendarIcon } from "lucide-react";

import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import { Calendar } from "@shared/shadcn/ui/calendar";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { Label } from "@shared/shadcn/ui/label";
import { ScrollArea, ScrollBar } from "@shared/shadcn/ui/scroll-area";

/** Unix seconds; `0` means never expires. */
export type ExpiresAtSeconds = number;

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

const PRESETS: { label: string; ms: number }[] = [
    { label: "+1 hour", ms: 60 * 60 * 1000 },
    { label: "+1 day", ms: 24 * 60 * 60 * 1000 },
    { label: "+7 days", ms: 7 * 24 * 60 * 60 * 1000 },
    { label: "+30 days", ms: 30 * 24 * 60 * 60 * 1000 },
];

function startOfLocalDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function roundUpToMinuteStep(d: Date, step = 5): Date {
    const out = new Date(d);
    const m = out.getMinutes();
    const rounded = Math.ceil(m / step) * step;
    if (rounded === 60) {
        out.setHours(out.getHours() + 1, 0, 0, 0);
    } else {
        out.setMinutes(rounded, 0, 0);
    }
    return out;
}

function defaultFuture(): Date {
    return roundUpToMinuteStep(new Date(Date.now() + 60 * 60 * 1000));
}

/** Policy expiry display: 0 = never; otherwise local datetime. */
export function formatExpiresAt(expiresAt: ExpiresAtSeconds): string {
    if (!expiresAt) return "Never";
    const d = new Date(expiresAt * 1000);
    if (Number.isNaN(d.getTime())) return String(expiresAt);
    return d.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    });
}

function combineDateTime(day: Date, hour: number, minute: number): Date {
    return new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        hour,
        minute,
        0,
        0,
    );
}

export function ExpiresAtPicker({
    value,
    onChange,
    label = "Expires",
    id,
}: {
    value: ExpiresAtSeconds;
    onChange: (seconds: ExpiresAtSeconds) => void;
    label?: string;
    id?: string;
}) {
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<"never" | "at">("never");
    const [day, setDay] = useState<Date>(() => startOfLocalDay(defaultFuture()));
    const [hour, setHour] = useState(() => defaultFuture().getHours());
    const [minute, setMinute] = useState(
        () => Math.round(defaultFuture().getMinutes() / 5) * 5,
    );

    // Sync draft when opening the dialog from current value.
    useEffect(() => {
        if (!open) return;
        if (!value) {
            setMode("never");
            const d = defaultFuture();
            setDay(startOfLocalDay(d));
            setHour(d.getHours());
            setMinute(Math.round(d.getMinutes() / 5) * 5);
            return;
        }
        setMode("at");
        const d = new Date(value * 1000);
        setDay(startOfLocalDay(d));
        setHour(d.getHours());
        setMinute(Math.round(d.getMinutes() / 5) * 5);
    }, [open, value]);

    const draftDate = useMemo(
        () => combineDateTime(day, hour, minute),
        [day, hour, minute],
    );

    const now = Date.now();
    const isPast = mode === "at" && draftDate.getTime() <= now;
    const canApply = mode === "never" || !isPast;

    const todayStart = startOfLocalDay(new Date());

    const applyPreset = (ms: number) => {
        const d = roundUpToMinuteStep(new Date(Date.now() + ms));
        setMode("at");
        setDay(startOfLocalDay(d));
        setHour(d.getHours());
        setMinute(d.getMinutes());
    };

    const handleApply = () => {
        if (mode === "never") {
            onChange(0);
            setOpen(false);
            return;
        }
        if (isPast) return;
        onChange(Math.floor(draftDate.getTime() / 1000));
        setOpen(false);
    };

    const handleClear = () => {
        onChange(0);
        setOpen(false);
    };

    return (
        <div className="grid gap-2">
            <Label htmlFor={id}>{label}</Label>
            <Button
                id={id}
                type="button"
                variant="outline"
                className={cn(
                    "w-full justify-start text-left font-normal",
                    !value && "text-muted-foreground",
                )}
                onClick={() => setOpen(true)}
            >
                <CalendarIcon className="mr-2 size-4 shrink-0" />
                <span className="truncate">
                    {value ? formatExpiresAt(value) : "Never expires"}
                </span>
            </Button>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="gap-4 sm:max-w-fit">
                    <DialogHeader>
                        <DialogTitle>Set expiry</DialogTitle>
                        <DialogDescription>
                            Policies can run indefinitely, or expire at a future
                            local date and time. Past times are not allowed.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant={mode === "never" ? "default" : "outline"}
                            onClick={() => setMode("never")}
                        >
                            Never
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant={mode === "at" ? "default" : "outline"}
                            onClick={() => setMode("at")}
                        >
                            Specific time
                        </Button>
                        {PRESETS.map((p) => (
                            <Button
                                key={p.label}
                                type="button"
                                size="sm"
                                variant="secondary"
                                onClick={() => applyPreset(p.ms)}
                            >
                                {p.label}
                            </Button>
                        ))}
                    </div>

                    {mode === "never" ? (
                        <p className="text-muted-foreground text-sm">
                            This policy will not expire.
                        </p>
                    ) : (
                        <div className="space-y-3">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                                <Calendar
                                    mode="single"
                                    selected={day}
                                    onSelect={(d) => {
                                        if (d) setDay(startOfLocalDay(d));
                                    }}
                                    disabled={{ before: todayStart }}
                                    initialFocus
                                />
                                <div className="flex h-[300px] divide-x border-t sm:border-t-0 sm:border-l">
                                    <ScrollArea className="w-full sm:w-auto">
                                        <div className="flex p-2 sm:flex-col">
                                            {HOURS.map((h) => (
                                                <Button
                                                    key={h}
                                                    type="button"
                                                    size="icon"
                                                    variant={
                                                        hour === h
                                                            ? "default"
                                                            : "ghost"
                                                    }
                                                    className="aspect-square shrink-0 sm:w-full"
                                                    onClick={() => setHour(h)}
                                                >
                                                    {h
                                                        .toString()
                                                        .padStart(2, "0")}
                                                </Button>
                                            ))}
                                        </div>
                                        <ScrollBar
                                            orientation="horizontal"
                                            className="sm:hidden"
                                        />
                                    </ScrollArea>
                                    <ScrollArea className="w-full sm:w-auto">
                                        <div className="flex p-2 sm:flex-col">
                                            {MINUTES.map((m) => (
                                                <Button
                                                    key={m}
                                                    type="button"
                                                    size="icon"
                                                    variant={
                                                        minute === m
                                                            ? "default"
                                                            : "ghost"
                                                    }
                                                    className="aspect-square shrink-0 sm:w-full"
                                                    onClick={() => setMinute(m)}
                                                >
                                                    {m
                                                        .toString()
                                                        .padStart(2, "0")}
                                                </Button>
                                            ))}
                                        </div>
                                        <ScrollBar
                                            orientation="horizontal"
                                            className="sm:hidden"
                                        />
                                    </ScrollArea>
                                </div>
                            </div>
                            <p
                                className={cn(
                                    "text-sm font-mono",
                                    isPast
                                        ? "text-destructive"
                                        : "text-muted-foreground",
                                )}
                            >
                                {isPast
                                    ? "Pick a time after now"
                                    : formatExpiresAt(
                                          Math.floor(
                                              draftDate.getTime() / 1000,
                                          ),
                                      )}
                            </p>
                        </div>
                    )}

                    <DialogFooter className="gap-2 sm:justify-between">
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={handleClear}
                        >
                            Clear to never
                        </Button>
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setOpen(false)}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                disabled={!canApply}
                                onClick={handleApply}
                            >
                                Apply
                            </Button>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
