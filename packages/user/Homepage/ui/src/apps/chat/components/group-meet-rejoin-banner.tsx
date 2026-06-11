import { PhoneCall } from "lucide-react";

import { Button } from "@shared/shadcn/ui/button";

type Props = {
    joinedCount: number;
    onRejoin: () => void;
};

export function GroupMeetRejoinBanner({ joinedCount, onRejoin }: Props) {
    const label =
        joinedCount === 1
            ? "1 participant in the Meet call"
            : `${joinedCount} participants in the Meet call`;

    return (
        <div className="flex items-center justify-between gap-3 border-b bg-muted/20 px-4 py-2">
            <div>
                <p className="text-sm font-medium">Meet call in progress</p>
                <p className="text-muted-foreground text-xs">{label}</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onRejoin}>
                <PhoneCall className="size-4" />
                Rejoin
            </Button>
        </div>
    );
}
