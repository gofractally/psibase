import { createFormHook, createFormHookContexts } from "@tanstack/react-form";

import { DateTimePicker24h } from "./date-time-picker";
import { EvaluationDurationSelect } from "./evaluation-duration-select";
import { NumberField } from "./number-field";
import { SelectField } from "./select-field";
import { SubmitButton } from "./submit-button";
import { TextField } from "./text-field";

export const { fieldContext, formContext, useFieldContext, useFormContext } =
    createFormHookContexts();

const { useAppForm, withForm, withFieldGroup } = createFormHook({
    fieldContext,
    formContext,
    fieldComponents: {
        TextField,
        NumberField,
        SelectField,
        DateTime: DateTimePicker24h,
        EvaluationDuration: EvaluationDurationSelect,
    },
    formComponents: {
        SubmitButton,
    },
});

export { useAppForm, withForm, withFieldGroup };
