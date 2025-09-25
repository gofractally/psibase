import { TriangleAlert } from "lucide-react";

import { Button } from "@shared/shadcn/ui/button";

export const NoTokensWarning = () => {
    return (
        <EmptyBlock
            title="Head's up!"
            description="You currently have no token balances or tokens to administer. Receive some tokens to continue."
        />
    );
};

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
        <div className="flex h-[450px] shrink-0 items-center justify-center rounded-md border border-dashed">
            <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
                <TriangleAlert className="h-12 w-12 text-yellow-500" />
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
