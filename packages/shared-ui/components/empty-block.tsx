import { FilePlus2, LucideProps } from "lucide-react";

import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";

interface Props {
    title: string;
    description?: string;
    buttonLabel?: string;
    onButtonClick?: () => void;
    Icon?: React.ForwardRefExoticComponent<
        Omit<LucideProps, "ref"> & React.RefAttributes<SVGSVGElement>
    >;
    iconClass?: string;
}

export const EmptyBlock = ({
    description,
    title,
    buttonLabel,
    onButtonClick,
    Icon = FilePlus2,
    iconClass = "",
}: Props) => {
    return (
        <div className="flex h-[450px] shrink-0 items-center justify-center rounded-md border border-dashed">
            <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
                <Icon className={cn("h-12 w-12", iconClass)} />
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
