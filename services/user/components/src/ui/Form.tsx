import classNames from "classnames";
import React, { forwardRef, HTMLProps } from "react";

import { Text } from ".";
import "../styles/inputs.css";
import Button from "./Button";
import { Icon, IconType } from "./Icon";

export const Label: React.FC<{
  htmlFor: string;
}> = (props) => (
  <label className="block text-sm font-normal text-gray-600" {...props}>
    {props.children}
  </label>
);

export interface InputProps extends HTMLProps<HTMLInputElement> {
  label?: string;
  rightIcon?: IconType;
  helperText?: string;
  successText?: string;
  errorText?: string;
  onClickRightIcon?: () => void;
}

export const Input = forwardRef<HTMLInputElement, InputProps>((props, ref) => {
  const {
    label,
    rightIcon,
    helperText,
    successText,
    errorText,
    onClickRightIcon,
    ...inputProps
  } = props;

  const subText = props.errorText ?? props.successText ?? props.helperText;
  const hasError = Boolean(props.errorText);

  const borderColor = hasError
    ? "border-red-500"
    : "border-gray-500 focus-visible:border-gray-400";

  const subTextColor = hasError
    ? "text-red-500"
    : props.successText
    ? "text-green-500"
    : "";

  return (
    <fieldset
      className="space-y-1 text-gray-500 disabled:text-gray-300"
      disabled={props.disabled}
    >
      {props.label && (
        <label htmlFor={props.id}>
          <Text span size="sm" className="select-none font-semibold">
            {props.label}
          </Text>
        </label>
      )}
      <div className="relative">
        <input
          name={props.id}
          className={classNames(
            "Input w-full border bg-white px-3 py-4 text-lg text-gray-900 outline-none placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-gray-500",
            borderColor,
          )}
          ref={ref}
          {...inputProps}
        />
        {rightIcon && (
          <Button
            type="icon"
            onClick={onClickRightIcon}
            className="absolute top-[18px] right-3"
          >
            <Icon type={rightIcon} iconStyle="outline" size="base" />
          </Button>
        )}
        {subText && (
          <Text
            span
            size="sm"
            className={classNames("select-none font-semibold", subTextColor)}
          >
            {subText}
          </Text>
        )}
      </div>
    </fieldset>
  );
});

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
  },
);

export interface SelectProps extends HTMLProps<HTMLSelectElement> {
  label?: string;
  helperText?: string;
  successText?: string;
  errorText?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (props, ref) => {
    const subText = props.errorText ?? props.successText ?? props.helperText;
    const hasError = Boolean(props.errorText);

    const borderColor = hasError
      ? "border-red-500"
      : "border-gray-500 focus-visible:border-gray-400";

    const subTextColor = hasError
      ? "text-red-500"
      : props.successText
      ? "text-green-500"
      : "";

    return (
      <fieldset
        className="space-y-1 text-gray-500 disabled:text-gray-300"
        disabled={props.disabled}
      >
        {props.label && (
          <label htmlFor={props.id}>
            <Text span size="sm" className="select-none font-semibold">
              {props.label}
            </Text>
          </label>
        )}
        <select
          className={classNames(
            "Input w-full border bg-white px-3 py-4 text-lg text-gray-900 outline-none placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-gray-500",
            borderColor,
          )}
          {...props}
          ref={ref}
        >
          {props.children}
        </select>
        {subText && (
          <Text
            span
            size="sm"
            className={classNames("select-none font-semibold", subTextColor)}
          >
            {subText}
          </Text>
        )}
      </fieldset>
    );
  },
);

export interface TextAreaWithLabelProps extends HTMLProps<HTMLTextAreaElement> {
  label?: string;
  helperText?: string;
  successText?: string;
  errorText?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaWithLabelProps>(
  (props, ref) => {
    const subText = props.errorText ?? props.successText ?? props.helperText;
    const hasError = Boolean(props.errorText);

    const borderColor = hasError
      ? "border-red-500"
      : "border-gray-500 focus-visible:border-gray-400";

    const subTextColor = hasError
      ? "text-red-500"
      : props.successText
      ? "text-green-500"
      : "";

    return (
      <fieldset
        className="space-y-1 text-gray-500 disabled:text-gray-300"
        disabled={props.disabled}
      >
        {props.label && (
          <label htmlFor={props.id}>
            <Text span size="sm" className="select-none font-semibold">
              {props.label}
            </Text>
          </label>
        )}
        <textarea
          rows={3}
          name={props.id}
          className={classNames(
            "Input block w-full resize-none border bg-white py-4 px-3 text-lg leading-6 text-gray-900 outline-none placeholder:text-gray-400 focus-visible:ring-2 focus:ring-gray-500",
            borderColor,
          )}
          ref={ref}
          {...props}
        />
        {subText && (
          <Text
            span
            size="sm"
            className={classNames("select-none font-semibold", subTextColor)}
          >
            {subText}
          </Text>
        )}
      </fieldset>
    );
  },
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
        className="flex place-items-center gap-4 bg-gray-100 p-3 font-medium text-gray-700"
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
  },
);

export interface LabeledSetProps {
  htmlFor: string;
  label: string;
  description?: string;
  className?: string;
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
  },
);

export const Form = {
  Label,
  Input,
  Select,
  TextArea,
  LabeledSet,
  FileInput,
  Checkbox,
};

export default Form;
