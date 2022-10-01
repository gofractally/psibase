import React, { forwardRef, HTMLProps, useState } from "react";

export interface SwitchProps extends HTMLProps<HTMLInputElement> {
    disabled?: boolean;
    label?: string;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
    (props, ref) => {

        const [stateOn, set] = useState(true);
        const stateOnClass = ' transform translate-x-5';

        return (
            <label
                htmlFor={props.id}
                className="Switch flex place-items-center gap-4 bg-gray-100 p-3 font-medium text-gray-700"
            >
                <div className="flex-0">{props.label}</div>
                <div className="md:w-14 md:h-7 w-12 h-6 flex items-center bg-gray-300 rounded-full p-1 cursor-pointer">
                    <input
                        type="checkbox"
                        className={`bg-white md:w-6 md:h-6 h-5 w-5 rounded-full shadow-md transform ${stateOn ? null : stateOnClass}`}
                        ref={ref}
                        {...props}
                    />
                </div>
            </label>
        );
    }
);
