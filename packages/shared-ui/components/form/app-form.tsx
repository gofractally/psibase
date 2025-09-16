import { createFormHook, createFormHookContexts } from "@tanstack/react-form";

import { DateTimePicker24h } from "./date-time-picker";
import { DurationSelect } from "./duration-select";
import { NumberField } from "./number-field";
import { SubmitButton } from "./submit-button";
import { TextField } from "./text-field";
import { TokenSelect } from "./token-select";

export const { fieldContext, formContext, useFieldContext, useFormContext } =
    createFormHookContexts();

const { useAppForm, withForm, withFieldGroup } = createFormHook({
    fieldContext,
    formContext,
    fieldComponents: {
        TextField,
        NumberField,
        DateTime: DateTimePicker24h,
        Duration: DurationSelect,
        TokenSelect,
    },
    formComponents: {
        SubmitButton,
    },
});

export { useAppForm, withForm, withFieldGroup };
