import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@shared/shadcn/ui/button";

interface PrevNextProps {
    previous: () => void;
    next: () => void;
    canPrev: boolean;
    canNext: boolean;
    nextLabel?: string;
}

export const PrevNextButtons = ({
    canNext,
    canPrev,
    next,
    previous,
    nextLabel = "Continue",
}: PrevNextProps) => (
    <div className="flex w-full items-center justify-between gap-3">
        <Button
            type="button"
            variant="outline"
            onClick={previous}
            disabled={!canPrev}
        >
            <ChevronLeft />
            Back
        </Button>

        <Button type="button" onClick={next} disabled={!canNext}>
            {nextLabel}
            <ChevronRight />
        </Button>
    </div>
);
