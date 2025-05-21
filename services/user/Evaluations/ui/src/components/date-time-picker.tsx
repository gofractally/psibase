"use client";

import * as React from "react";
import { useFieldContext } from "./app-form";
import { TimePickerDemo } from "./time-picker-demo";

export function DateTimePicker24h({
    label,
    description,
}: {
    label: string;
    description?: string;
}) {
    const [isOpen, setIsOpen] = React.useState(false);
    const field = useFieldContext();
    const date = field.state.value as Date;


    const handleSetNow = () => {
        const now = new Date();
        field.handleChange(now);
    };

    console.log(date, 'is the date?')

    return (
        <div>
            <div className="flex justify-between">
                <div>{label}</div>
                <div>{description}</div>
            </div>
            <TimePickerDemo
                date={date}
                setDate={(date) => {
                    field.handleChange(date);
                }}
            />
        </div>
    );
}
