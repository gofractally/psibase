import { createFormHook, createFormHookContexts } from "@tanstack/react-form";

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
