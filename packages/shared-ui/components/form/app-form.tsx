import { createFormHook, createFormHookContexts } from "@tanstack/react-form";

import { CheckboxField } from "./internal/checkbox-field";
import { DateTimePicker24h } from "./internal/date-time-picker";
import { DurationSelect } from "./internal/duration-select";
import { NumberField } from "./internal/number-field";
import { SelectField } from "./internal/select-field";
import { SubmitButton } from "./internal/submit-button";
import { SwitchField } from "./internal/switch-field";
import { TextArea } from "./internal/text-area";
import { TextField } from "./internal/text-field";

export const { fieldContext, formContext, useFieldContext, useFormContext } =
    createFormHookContexts();

const { useAppForm, withForm, withFieldGroup } = createFormHook({
    fieldContext,
    formContext,
    fieldComponents: {
        TextArea,
        TextField,
        NumberField,
        SelectField,
        SwitchField,
        DateTimePickerField: DateTimePicker24h,
        DurationSelectField: DurationSelect,
        CheckboxField,
    },
    formComponents: {
        SubmitButton,
    },
});

export { useAppForm, withForm, withFieldGroup };
