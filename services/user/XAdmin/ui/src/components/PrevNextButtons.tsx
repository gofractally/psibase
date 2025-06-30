import { Button } from "@shared/shadcn/ui/button";
import {
    ChevronRight,
    ChevronLeft,
    ChevronLast,
    ChevronFirst,
} from "lucide-react";

interface PrevNextProps {
    previous: () => void;
    next: () => void;
    canPrev: boolean;
    canNext: boolean;
}

export const PrevNextButtons = ({
    canNext,
    canPrev,
    next,
    previous,
}: PrevNextProps) => (
    <div className="flex w-full justify-between">
        <Button
            variant="ghost"
            onClick={() => {
                previous();
            }}
            disabled={!canPrev}
        >
            {canPrev ? <ChevronLeft /> : <ChevronFirst />}
        </Button>

        <Button
            variant="ghost"
            onClick={() => {
                next();
            }}
            disabled={!canNext}
        >
            {canNext ? <ChevronRight /> : <ChevronLast />}
        </Button>
    </div>
);
