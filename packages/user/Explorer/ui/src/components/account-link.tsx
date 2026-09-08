import { Link } from "react-router-dom";

import { colorFor } from "@/lib/colors";

import { cn } from "@shared/lib/utils";

interface Props {
    name: string;
    className?: string;
    dot?: boolean;
    mono?: boolean;
}

export const AccountLink = ({ name, className, dot = true, mono = true }: Props) => {
    if (!name) {
        return (
            <span
                className={cn(
                    "text-muted-foreground inline-flex items-center gap-1.5 text-xs italic",
                    className,
                )}
            >
                system
            </span>
        );
    }
    return (
        <Link
            to={`/accounts/${name}`}
            className={cn(
                "text-foreground/90 hover:text-primary inline-flex items-center gap-1.5 hover:underline",
                mono && "font-mono text-[13px]",
                className,
            )}
        >
            {dot && (
                <span
                    aria-hidden
                    className="inline-block size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: colorFor(name) }}
                />
            )}
            <span className="truncate">{name}</span>
        </Link>
    );
};
