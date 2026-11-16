import { unixSeconds } from "@/lib/social";

import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

const shortDuration = (deltaSeconds: number) => {
    const delta = Math.max(0, Math.floor(deltaSeconds));
    if (delta < 60) return "now";
    if (delta < 3600) return `${Math.floor(delta / 60)}m`;
    if (delta < 86400) return `${Math.floor(delta / 3600)}h`;
    return `${Math.floor(delta / 86400)}d`;
};

const absoluteTime = (seconds: number) =>
    new Date(seconds * 1000).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });

const TimeLabel = ({ at, label }: { at: number; label: string }) => (
    <Tooltip>
        <TooltipTrigger asChild>
            <span className="text-muted-foreground text-[13px]">{label}</span>
        </TooltipTrigger>
        <TooltipContent>{absoluteTime(at)}</TooltipContent>
    </Tooltip>
);

export const PostedAt = ({ value }: { value: string }) => {
    const seconds = unixSeconds(value);
    if (!seconds) return null;
    return (
        <TimeLabel
            at={seconds}
            label={shortDuration(Math.floor(Date.now() / 1000) - seconds)}
        />
    );
};

/** Time left in the bidding window, in the same short form as a post's age. */
export const BidLeft = ({
    createdAt,
    bidSeconds,
}: {
    createdAt: string;
    bidSeconds: number;
}) => {
    const start = unixSeconds(createdAt);
    if (!start || bidSeconds <= 0) return null;
    const ends = start + bidSeconds;
    const left = ends - Math.floor(Date.now() / 1000);
    if (left <= 0) return null;
    return <TimeLabel at={ends} label={shortDuration(left)} />;
};
