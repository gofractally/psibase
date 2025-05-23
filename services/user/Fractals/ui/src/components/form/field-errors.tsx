import type { AnyFieldMeta } from "@tanstack/react-form";

import { parseError } from "@/lib/parseErrorMessage";

type FieldErrorsProps = {
    meta: AnyFieldMeta;
};

export const FieldErrors = ({ meta }: FieldErrorsProps) => {
    if (!meta.isTouched || !meta.isBlurred) return null;

    return meta.errors.map(parseError).map((error, index) => (
        <p key={index} className="text-sm text-destructive">
            {error}
        </p>
    ));
};
