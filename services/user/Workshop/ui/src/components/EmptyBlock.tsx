import { FilePlus2 } from "lucide-react";

import { Button } from "@shared/shadcn/ui/button";

interface Props {
    title: string;
    description?: string;
    buttonLabel?: string;
    onButtonClick?: () => void;
}

export const EmptyBlock = ({
    description,
    title,
    buttonLabel,
    onButtonClick,
}: Props) => {
    return (
        <div className="border-primary/50 flex h-[450px] shrink-0 items-center justify-center rounded-md border border-dashed">
            <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
                <FilePlus2 className="h-12 w-12 " />
                <h3 className="mt-4 text-lg font-semibold">{title}</h3>
                {description && (
                    <p className="text-muted-foreground mb-4 mt-2 text-sm">
                        {description}
                    </p>
                )}
                {onButtonClick && (
                    <Button
                        size="sm"
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
