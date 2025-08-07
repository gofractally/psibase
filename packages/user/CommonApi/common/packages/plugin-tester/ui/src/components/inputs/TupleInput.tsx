import { ReactNode } from "react";

import { Schema } from "../../types";
import { TypeBasedInput } from "./TypeBasedInput";

interface TupleInputProps {
    types: unknown[];
    schema: Schema;
    value: unknown[];
    onChange: (value: unknown[]) => void;
    label?: ReactNode;
}

export const TupleInput = ({
    types,
    schema,
    value = [],
    onChange,
    label,
}: TupleInputProps) => {
    const handleItemChange = (index: number, newValue: unknown) => {
        const newTuple = [...value];
        newTuple[index] = newValue;
        onChange(newTuple);
    };

    return (
        <div className="input-field">
            {label && <label>{label}</label>}
            <div className="tuple-items">
                {types.map((type, index) => (
                    <div key={index} className="tuple-item">
                        <TypeBasedInput
                            type={type}
                            schema={schema}
                            value={value[index]}
                            onChange={(newValue) =>
                                handleItemChange(index, newValue)
                            }
                            label={`Item ${index + 1}`}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
};
