import type { AnyFieldMeta } from "@tanstack/react-form";

import { parseError } from "@/lib/parseErrorMessage";

type FieldErrorsProps = {
    meta: AnyFieldMeta | undefined;
};

export const FieldErrors = ({ meta }: FieldErrorsProps) => {
    if (!meta) return null;

    return meta.errors.map(parseError).map((error, index) => (
        <p key={index} className="text-sm text-red-300">
            {error}
        </p>
    ));
};
