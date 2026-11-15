import { Bell } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { formatRawAmount } from "@/lib/format-token";
import { getNotifications } from "@/lib/social";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Button } from "@shared/shadcn/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@shared/shadcn/ui/popover";

const seenKey = (user: string) => `social-notes-seen-${user}`;

const readSeen = (user: string) => {
    if (typeof localStorage === "undefined") return 0;
    const raw = localStorage.getItem(seenKey(user));
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
};

export const Notifications = () => {
    const navigate = useNavigate();
    const { data: currentUser } = useCurrentUser();
    const [open, setOpen] = useState(false);
    const [seen, setSeen] = useState(0);

    const notes = useQuery({
        queryKey: ["social-notifications", currentUser],
        enabled: Boolean(currentUser),
        queryFn: () => getNotifications(currentUser!),
        refetchInterval: 30_000,
    });

    const rows = notes.data ?? [];
    const newest = rows.reduce(
        (max, row) => Math.max(max, Number(row.cursor) || 0),
        0,
    );
    const stored = currentUser ? readSeen(currentUser) : 0;
    const unread = rows.filter((row) => (Number(row.cursor) || 0) > Math.max(seen, stored))
        .length;

    const markSeen = () => {
        if (!currentUser || newest === 0) return;
        localStorage.setItem(seenKey(currentUser), String(newest));
        setSeen(newest);
    };

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                if (next) markSeen();
            }}
        >
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="relative rounded-full"
                    aria-label="Notifications"
                >
                    <Bell />
                    {unread > 0 && (
                        <span className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold">
                            {unread > 9 ? "9+" : unread}
                        </span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
                <div className="border-b px-3 py-2 text-sm font-semibold">
                    Notifications
                </div>
                <div className="max-h-80 overflow-y-auto">
                    {!currentUser && (
                        <p className="text-muted-foreground px-3 py-4 text-sm">
                            Log in to see when you are outbid.
                        </p>
                    )}
                    {currentUser && notes.isLoading && (
                        <p className="text-muted-foreground px-3 py-4 text-sm">
                            Loading.
                        </p>
                    )}
                    {currentUser && notes.error && (
                        <p className="px-3 py-4 text-sm text-red-600">
                            Couldn't load notifications.
                        </p>
                    )}
                    {currentUser && !notes.isLoading && !notes.error && rows.length === 0 && (
                        <p className="text-muted-foreground px-3 py-4 text-sm">
                            No one has outbid you yet.
                        </p>
                    )}
                    {rows.map((row) => (
                        <button
                            key={row.cursor}
                            type="button"
                            className="hover:bg-muted flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left"
                            onClick={() => {
                                setOpen(false);
                                navigate(`/threads/${row.thread}/post/${row.post}`);
                            }}
                        >
                            <span className="text-sm">
                                <span className="font-semibold">{row.bidder}</span>{" "}
                                outbid you
                            </span>
                            <span className="text-muted-foreground text-xs">
                                {formatRawAmount(row.returned)} returned · {row.thread}
                            </span>
                        </button>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
};
