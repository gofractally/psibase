import * as React from "react";

import { cn } from "@shared/lib/utils";
import { Label } from "@shared/shadcn/ui/label";
import { Textarea } from "@shared/shadcn/ui/textarea";

import { useFieldContext } from "../app-form";

export type TextInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
    ref?: React.Ref<HTMLInputElement>;
    rows?: number;
    label?: string;
};

export const TextArea = ({ label, ...props }: TextInputProps) => {
    const field = useFieldContext<string>();

    const isError = field.state.meta.errors.length > 0;

    const isTouched = field.state.meta.isTouched;

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <Label
                    className={cn(isError && isTouched && "text-destructive")}
                >
                    {label}
                </Label>
            </div>
            <Textarea
                id={props.id}
                placeholder={props.placeholder}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                rows={props.rows}
            />
        </div>
    );
};
