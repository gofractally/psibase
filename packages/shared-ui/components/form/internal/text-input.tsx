import * as React from "react";

import { cn } from "@shared/lib/utils";

export type TextInputProps = Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "type"
> & {
    startContent?: React.ReactNode;
    endContent?: React.ReactNode;
    ref?: React.Ref<HTMLInputElement>;
};

export const TextInput = ({
    className,
    startContent,
    endContent,
    ref,
    ...props
}: TextInputProps) => {
    return (
        <div
            className={cn(
                "border-input shadow-xs dark:bg-input/30 group flex h-9 w-full min-w-0 items-center rounded-md border bg-transparent outline-none transition-[color,box-shadow] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
                "has-[:focus]:border-ring has-[:focus]:ring-ring/50 has-[:focus]:ring-[3px]",
                "has-aria-invalid:ring-destructive/20 dark:has-aria-invalid:ring-destructive/40 has-aria-invalid:border-destructive",
                className,
            )}
        >
            {startContent && (
                <span className="text-muted-foreground pointer-events-none flex items-center">
                    {startContent}
                </span>
            )}
            <input
                ref={ref}
                type="text"
                {...props}
                className={cn(
                    "placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground w-full border-0 bg-transparent px-3 py-1 text-base outline-none ring-0 focus-visible:outline-none disabled:pointer-events-none disabled:cursor-not-allowed md:text-sm",
                    {
                        "pl-0": !!startContent,
                        "pr-0": !!endContent,
                    },
                )}
            />
            {endContent && (
                <span className="text-muted-foreground pointer-events-none flex items-center">
                    {endContent}
                </span>
            )}
        </div>
    );
};
