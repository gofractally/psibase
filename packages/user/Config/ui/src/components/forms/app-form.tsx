import { createFormHook } from "@tanstack/react-form";

import {
    fieldContext,
    formContext,
    useFieldContext,
    useFormContext,
} from "@shared/components/form/app-form";
import { CheckboxField } from "@shared/components/form/internal/checkbox-field";
import { NumberField } from "@shared/components/form/internal/number-field";
import { TextField } from "@shared/components/form/internal/text-field";

import { SubmitButton } from "./submit-button";

const { useAppForm, withForm } = createFormHook({
    fieldContext,
    formContext,
    fieldComponents: {
        TextField,
        NumberField,
        CheckboxField,
    },
    formComponents: {
        SubmitButton,
    },
});

export { useFieldContext, useFormContext };
export {
    useAppForm,
    /**
     * @deprecated Currently has some issues.
     * @see https://github.com/TanStack/form/issues/1296
     */
    withForm,
};
