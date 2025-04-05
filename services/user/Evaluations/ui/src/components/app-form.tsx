import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import { SubmitButton } from "./submit-button";
import { DateTimePicker24h } from "./date-time-picker";
import { NumberField } from "./number-field";

export const { fieldContext, formContext, useFieldContext, useFormContext } =
    createFormHookContexts();

const { useAppForm } = createFormHook({
    fieldContext,
    formContext,
    fieldComponents: {
        DateTimeField: DateTimePicker24h,
        NumberField,
    },
    formComponents: {
        SubmitButton,
    },
});

export { useAppForm };
