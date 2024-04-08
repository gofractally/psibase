import React, { forwardRef, HTMLProps } from "react";

import { Text } from ".";
import "../styles/inputs.css";
import Button from "./button";
import { Icon, IconType } from "./icon";

export const Label: React.FC<{
    htmlFor: string;
    children: React.ReactNode;
}> = (props) => (
    <label className="block text-sm font-normal text-gray-600" {...props}>
        {props.children}
    </label>
);

type SubText = {
    helperText?: string;
    successText?: string;
    errorText?: string;
};

interface FieldSetProps {
    disabled?: boolean;
    label?: string;
    id?: string;
    children: React.ReactNode;
}

const FieldSet = ({
    disabled,
    label,
    id,
    helperText,
    successText,
    errorText,
    children,
}: FieldSetProps & SubText) => {
    const subText = errorText ?? successText ?? helperText;
    const hasError = Boolean(errorText);

    const subTextColor = hasError
        ? "text-red-500"
        : successText
        ? "text-green-500"
        : "";

    return (
        <fieldset
            className="space-y-1 text-gray-500 disabled:text-gray-300"
            disabled={disabled}
        >
            {label && (
                <label htmlFor={id}>
                    <Text
                        span
                        size="sm"
                        className="select-none font-semibold text-gray-900"
                    >
                        {label}
                    </Text>
                </label>
            )}
            <div className="relative">
                {children}
                {subText && (
                    <Text
                        span
                        size="sm"
                        className={`select-none font-semibold ${subTextColor}`}
                    >
                        {subText}
                    </Text>
                )}
            </div>
        </fieldset>
    );
};

export interface InputProps extends HTMLProps<HTMLInputElement> {
    label?: string;
    rightIcon?: IconType;
    onClickRightIcon?: () => void;
}

export const Input = forwardRef<HTMLInputElement, InputProps & SubText>(
    (props, ref) => {
        const {
            label,
            rightIcon,
            helperText,
            successText,
            errorText,
            onClickRightIcon,
            ...inputProps
        } = props;
        const hasError = Boolean(errorText);
        const borderColor = hasError
            ? "border-red-500"
            : "border-gray-500 focus-visible:border-gray-400";

        return (
            <FieldSet
                disabled={props.disabled}
                label={props.label}
                id={props.id}
                helperText={props.helperText}
                successText={props.successText}
                errorText={props.errorText}
            >
                <input
                    name={props.id}
                    className={`Input w-full border bg-white px-3 py-4 text-lg text-gray-900 outline-none placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-gray-500 ${borderColor}`}
                    ref={ref}
                    {...inputProps}
                />
                {rightIcon && (
                    <Button
                        type="icon"
                        onClick={onClickRightIcon}
                        className="absolute top-[18px] right-3"
                    >
                        <Icon
                            type={rightIcon}
                            iconStyle="outline"
                            size="base"
                        />
                    </Button>
                )}
            </FieldSet>
        );
    }
);

export interface SelectProps extends HTMLProps<HTMLSelectElement> {
    label?: string;
    disabled?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps & SubText>(
    (props, ref) => {
        const { label, helperText, successText, errorText, ...selectProps } =
            props;

        const hasError = Boolean(errorText);
        const borderColor = hasError
            ? "border-red-500"
            : "border-gray-500 focus-visible:border-gray-400";

        return (
            <FieldSet
                disabled={props.disabled}
                label={props.label}
                id={props.id}
                helperText={props.helperText}
                successText={props.successText}
                errorText={props.errorText}
            >
                <select
                    className={`Input w-full border bg-white px-3 py-4 text-lg text-gray-900 outline-none placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-gray-500 ${borderColor}`}
                    {...selectProps}
                    ref={ref}
                >
                    {props.children}
                </select>
            </FieldSet>
        );
    }
);

export interface FileInputProps extends HTMLProps<HTMLInputElement> {
    disabled?: boolean;
    label?: string;
}

export const FileInput = forwardRef<HTMLInputElement, FileInputProps>(
    (props, ref) => {
        return (
            <label
                htmlFor={props.id}
                className="relative cursor-pointer rounded-md font-medium text-blue-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-blue-400 focus-within:ring-offset-2 hover:text-blue-400"
            >
                <span>{props.label || "Attach File..."}</span>
                <input ref={ref} type="file" className="sr-only" {...props} />
            </label>
        );
    }
);

export interface TextAreaWithLabelProps extends HTMLProps<HTMLTextAreaElement> {
    disabled?: boolean;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaWithLabelProps>(
    (props, ref) => {
        return (
            <textarea
                rows={3}
                name={props.id}
                className={`h-32 w-full resize-none border border-gray-300 bg-white py-1 px-3 text-base leading-6 text-gray-700 outline-none transition-colors duration-200 ease-in-out focus:border-orange-500 focus:ring-2 focus:ring-orange-200 ${
                    props.disabled ? "bg-gray-50" : ""
                }`}
                ref={ref}
                {...props}
            />
        );
    }
);

export interface CheckboxProps extends HTMLProps<HTMLInputElement> {
    disabled?: boolean;
    label?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
    (props, ref) => {
        return (
            <label
                htmlFor={props.id}
                className="flex place-items-center gap-4 p-3 font-medium text-gray-700"
            >
                <input
                    type="checkbox"
                    className="Checkbox h-8 w-8 border-2"
                    ref={ref}
                    {...props}
                />
                <div className="flex-1">{props.label}</div>
            </label>
        );
    }
);

export interface RadioProps extends HTMLProps<HTMLInputElement> {
    disabled?: boolean;
    label?: string;
}

export const Radio = forwardRef<HTMLInputElement, RadioProps>((props, ref) => {
    return (
        <label
            htmlFor={props.id}
            className="flex place-items-center gap-4 p-3 font-medium text-gray-700"
        >
            <input type="radio" ref={ref} {...props} />
            <div className="flex-1">{props.label}</div>
        </label>
    );
});

export interface LabeledSetProps {
    htmlFor: string;
    label: string;
    description?: string;
    className?: string;
    children?: React.ReactNode;
}

export const LabeledSet = forwardRef<HTMLDivElement, LabeledSetProps>(
    (props, ref) => {
        const {
            htmlFor,
            label,
            children,
            description = undefined,
            className = undefined,
        } = props;
        return (
            <div ref={ref} className={className}>
                <Label htmlFor={htmlFor}>{label}</Label>
                <div className="mt-1">{children}</div>
                {description && (
                    <p className="mt-2 text-sm text-gray-500">{description}</p>
                )}
            </div>
        );
    }
);

export const Form = {
    Label,
    Input,
    Select,
    TextArea,
    LabeledSet,
    FileInput,
    Checkbox,
    Radio,
};

export default Form;
