import React, { forwardRef, HTMLProps } from "react";

export interface SwitchProps extends HTMLProps<HTMLInputElement> {
    checked: boolean;
    value?: string;
    disabled?: boolean;
    label?: string;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
    (props, ref) => {
        const checkedClassContainer = props.checked ? 'bg-gray-700 border-gray-700' : 'bg-transparent border-gray-400';
        const checkedClassInput = props.checked ? 'translate-x-6' : '';

        return (
            <label
                htmlFor={props.id}
                className="Switch flex place-items-center gap-4 p-3 font-medium text-gray-700"
            >
                <div className="flex-0">{props.label}</div>
                <div
                    className={`w-14 h-7 flex items-center border-2 rounded-full p-1 cursor-pointer ${checkedClassContainer}`}
                >
                    <input
                        type="checkbox"
                        className={`h-5 w-5 rounded-full transform ${checkedClassInput}`}
                        {...props}
                    />
                </div>
            </label>
        );
    }
);
