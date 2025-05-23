import * as React from "react";
import { cn } from "@lib/utils";
import { Cross, X } from "lucide-react";
import { Button } from "./button";

export interface InputProps
    extends React.InputHTMLAttributes<HTMLInputElement> {
    onButtonClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ className, type, onButtonClick, ...props }, ref) => {
        return (
            <div className="flex w-full">
                <input
                    type={type}
                    className={cn(
                        "flex h-10 w-full flex-1 rounded-md border border-input bg-background px-3 py-2 pr-20 text-sm text-primary ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
                        className,
                    )}
                    ref={ref}
                    {...props}
                />
                {onButtonClick && (
                    <Button
                        variant="outline"
                        type="button"
                        size="icon"
                        onClick={onButtonClick}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                )}
            </div>
        );
    },
);
Input.displayName = "Input";

export { Input };
