import { createFormHook, createFormHookContexts } from "@tanstack/react-form";

import { SubmitButton } from "./submit-button";
import { TextField } from "./text-field";

export const { fieldContext, formContext, useFieldContext, useFormContext } =
    createFormHookContexts();

const { useAppForm, withForm } = createFormHook({
    fieldContext,
    formContext,
    fieldComponents: {
        TextField,
    },
    formComponents: {
        SubmitButton,
    },
});

export { useAppForm, withForm };
