import { useFieldContext } from "./app-form";
import { TimePickerDemo } from "./time-picker-demo";

export function DateTimePicker24h({
    label,
    description,
}: {
    label: string;
    description?: string;
}) {
    const field = useFieldContext();
    const date = field.state.value as Date;

    console.log(date, "is the date?");

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
