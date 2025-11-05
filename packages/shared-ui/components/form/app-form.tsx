import { createFormHook, createFormHookContexts } from "@tanstack/react-form";

import { DateTimePicker24h } from "./internal/date-time-picker";
import { EvaluationDurationSelect } from "./internal/evaluation-duration-select";
import { NumberField } from "./internal/number-field";
import { SelectField } from "./internal/select-field";
import { SubmitButton } from "./internal/submit-button";
import { TextField } from "./internal/text-field";

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
