import { Button } from "@shared/shadcn/ui/button";
import { useFieldContext } from "./app-form";
import { Input } from "@shared/shadcn/ui/input";

export const NumbersField = ({ label }: { label: string }) => {
    const field = useFieldContext<number[]>();

    return (
        <div className="flex flex-col gap-2">
            <div>{label}</div>
            {field.state.value.map((value, index) => (
                <Input
                    key={index}
                    className="w-8"
                    value={value.toString()}
                    defaultValue={value.toString()}
                    onChange={(e) => {
                        console.log(e.target.value, "was received?");
                        field.replaceValue(index, Number(e.target.value));
                    }}
                />
            ))}
            <Button
                type="button"
                variant="outline"
                onClick={(e) => {
                    e.preventDefault();
                    const largestNumber = Math.max(...field.state.value);
                    field.pushValue(largestNumber + 1);
                }}
            >
                Add
            </Button>
        </div>
    );
};
