import { createFormHook, createFormHookContexts } from "@tanstack/react-form";

import { DateTimePicker24h } from "./date-time-picker";
import { DurationSelect } from "./duration-select";
import { NumberField } from "./number-field";
import { SubmitButton } from "./submit-button";
import { TextField } from "./text-field";

export const { fieldContext, formContext, useFieldContext, useFormContext } =
    createFormHookContexts();

const { useAppForm, withForm } = createFormHook({
    fieldContext,
    formContext,
    fieldComponents: {
        TextField,
        NumberField,
        DateTime: DateTimePicker24h,
        Duration: DurationSelect,
    },
    formComponents: {
        SubmitButton,
    },
});

export {
    useAppForm,
    /**
     * @deprecated Currently has some issues.
     * @see https://github.com/TanStack/form/issues/1296
     */
    withForm,
};
