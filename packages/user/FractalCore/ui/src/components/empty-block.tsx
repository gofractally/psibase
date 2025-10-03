import { FilePlus2 } from "lucide-react";

import { Button } from "@shared/shadcn/ui/button";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

interface Props {
    title: string;
    description?: string;
    buttonLabel?: string;
    isLoading?: boolean;
    onButtonClick?: () => void;
}

export const EmptyBlock = ({
    description,
    title,
    buttonLabel,
    isLoading = false,
    onButtonClick,
}: Props) => {

    if (isLoading) {
        return <Skeleton className="h-[450px] w-full rounded-md" />
    }
    return (
        <div className="flex h-[450px] shrink-0 items-center justify-center rounded-md border border-dashed">
            <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
                <FilePlus2 className="h-12 w-12 " />
                <h3 className="mt-4 text-lg font-semibold">{title}</h3>
                {description && (
                    <p className="text-muted-foreground mt-2 text-sm">
                        {description}
                    </p>
                )}
                {onButtonClick && (
                    <Button
                        size="lg"
                        className="mt-4"
                        onClick={() => {
                            onButtonClick();
                        }}
                    >
                        {buttonLabel || ""}
                    </Button>
                )}
            </div>
        </div>
    );
};
