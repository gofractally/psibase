import { createFormHook, createFormHookContexts } from "@tanstack/react-form";

import { DateTimePicker24h } from "./date-time-picker";
import { DurationSelect } from "./duration-select";
import { NumberField } from "./number-field";
import { SubmitButton } from "./submit-button";
import { TextField } from "./text-field";
import { TokenAmountInput } from "./token-amount-input";
import { TokenSelect } from "./token-select";

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
        TokenSelect,
        TokenAmountInput,
    },
    formComponents: {
        SubmitButton,
    },
});

export { useAppForm, withForm };
