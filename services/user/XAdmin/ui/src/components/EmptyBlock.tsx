import { FilePlus2 } from "lucide-react";
import { Button } from "./ui/button";

interface Props {
    title: string;
    description?: string;
    buttonLabel: string;
    onClick: () => void;
}

export const EmptyBlock = ({
    description,
    title,
    onClick,
    buttonLabel,
}: Props) => {
    return (
        <div className="flex h-[450px] shrink-0 items-center justify-center rounded-md border border-dashed">
            <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
                <FilePlus2 className="h-12 w-12 " />
                <h3 className="mt-4 text-lg font-semibold">{title}</h3>
                {description && (
                    <p className="mb-4 mt-2 text-sm text-muted-foreground">
                        {description}
                    </p>
                )}
                <Button size="sm" onClick={() => onClick()}>
                    {buttonLabel}
                </Button>
            </div>
        </div>
    );
};
