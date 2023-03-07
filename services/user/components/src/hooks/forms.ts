import { useState } from "react";

export type SetValuesEvent = (event?: {
    target: { id: string; value: any; checked?: boolean; type: string };
}) => void;

export const useFormFields = <T>(initialState: T): [T, SetValuesEvent] => {
    const [fields, setValues] = useState<T>(initialState);

    return [
        fields,
        (event = undefined) => {
            if (!event) {
                setValues(initialState);
                return;
            }

            if (event.target.type === "checkbox") {
                setValues({
                    ...fields,
                    [event.target.id]: event.target.checked,
                });
                return;
            }

            setValues({
                ...fields,
                [event.target.id]: event.target.value,
            });
        },
    ];
};
