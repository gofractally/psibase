import { createFormHook, createFormHookContexts } from "@tanstack/react-form";

import { DateTimePicker24h } from "./date-time-picker";
import { DurationSelect } from "./duration-select";
import { NumberField } from "./number-field";
import { SubmitButton } from "./submit-button";

export const { fieldContext, formContext, useFieldContext, useFormContext } =
    createFormHookContexts();

const { useAppForm } = createFormHook({
    fieldContext,
    formContext,
    fieldComponents: {
        DateTimeField: DateTimePicker24h,
        NumberField,
        DurationField: DurationSelect,
    },
    formComponents: {
        SubmitButton,
    },
});

export { useAppForm };
