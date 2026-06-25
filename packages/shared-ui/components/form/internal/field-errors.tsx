import type { AnyFieldMeta } from "@tanstack/react-form";

import { parseError } from "@shared/lib/parse-error-message";
import { cn } from "@shared/lib/utils";

type FieldErrorsProps = {
    meta: AnyFieldMeta | undefined;
    /** Reserve fixed height so messages appearing on submit do not shift layout. */
    reserveSpace?: boolean;
    /** Tighter text for dense multi-column forms. */
    compact?: boolean;
};

export const FieldErrors = ({
    meta,
    reserveSpace = false,
    compact = false,
}: FieldErrorsProps) => {
    const errors =
        meta?.isTouched && meta.errors.length > 0
            ? meta.errors.map(parseError)
            : [];

    if (!reserveSpace && errors.length === 0) {
        return null;
    }

    return (
        <div
            className={cn(
                reserveSpace && (compact ? "h-8" : "h-5"),
                !reserveSpace && errors.length === 0 && "hidden",
            )}
            aria-live="polite"
        >
            {errors.map((error, index) => (
                <p
                    key={index}
                    className={cn(
                        "text-destructive",
                        compact
                            ? "line-clamp-2 text-xs leading-4"
                            : "text-sm",
                    )}
                    title={compact ? error : undefined}
                >
                    {error}
                </p>
            ))}
        </div>
    );
};
