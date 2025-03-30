import { type AnyFieldMeta } from "@tanstack/react-form";
import { z } from "zod";

type FieldErrorsProps = {
    meta: AnyFieldMeta;
};

const parseErrors = (errors: unknown[]): string[] =>
    errors.map((error: unknown): string =>
        typeof error === "object" && error !== null && "message" in error
            ? z.string().parse(error.message)
            : typeof error == "string"
              ? z.string().parse(error)
              : JSON.stringify(error),
    );

export const FieldErrors = ({ meta }: FieldErrorsProps) => {
    if (!meta.isTouched || !meta.isBlurred) return null;

    return parseErrors(meta.errors).map((error, index) => (
        <p key={index} className="text-sm text-destructive">
            {error}
        </p>
    ));
};
