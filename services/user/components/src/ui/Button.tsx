import React from "react";
import { Link } from "react-router-dom";

import Loader from "./Loader";
import Text, { TextSize } from "./Text";

export interface ButtonProps {
    children: React.ReactNode;
    onClick?: (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void;
    type?: ButtonType;
    isSubmit?: boolean;
    disabled?: boolean;
    isLoading?: boolean;
    size?: ButtonSize;
    fullWidth?: boolean;
    className?: string;
    href?: string;
    target?: string;
    isExternal?: boolean;
    title?: string;
    dataTestId?: string;
}

export type ButtonSize = "xs" | "sm" | "base" | "lg" | "xl";
const SIZE_CLASS: { [key in ButtonSize]: string } = {
    xs: "py-1.5 px-2.5",
    sm: "py-2 px-4",
    base: "py-2 px-5",
    lg: "py-2.5 px-6",
    xl: "py-3 px-5",
};

const TEXT_SIZE: { [key in ButtonSize]: TextSize } = {
    xs: "sm",
    sm: "sm",
    base: "base",
    lg: "lg",
    xl: "lg",
};

export type ButtonType =
    | "primary"
    | "secondary"
    | "cta_fractally"
    | "outline"
    | "link"
    | "icon";
const TYPE_CLASS: {
    [key in ButtonType]: { enabled: string; disabled: string };
} = {
    primary: {
        enabled:
            "bg-gray-200 text-gray-800 hover:bg-gray-300 hover:text-gray-800 active:bg-gray-400 focus-visible:ring-2 ring-gray-700 outline-none",
        disabled: "bg-gray-200 text-white",
    },
    secondary: {
        enabled:
            "bg-gray-50 text-gray-700 hover:bg-blue-50 focus:ring-4 ring-gray-100",
        disabled: "bg-blue-50 text-gray-300",
    },
    cta_fractally: {
        enabled:
            "bg-green-500 text-white hover:bg-green-600 hover:text-white active:bg-green-700 active:text-white focus-visible:ring-2 ring-gray-700 outline-none",
        disabled:
            "bg-gray-200 text-white hover:text-white focus-visible:ring-2 ring-gray-700 outline-none",
    },
    outline: {
        enabled: "border border-gray-200 text-gray-700",
        disabled: "border border-gray-200 text-gray-300",
    },
    link: {
        enabled: "text-blue-700",
        disabled: "text-blue-200",
    },
    icon: {
        enabled: "text-gray-400 hover:text-gray-500",
        disabled: "text-gray-200",
    },
};

/**
 * Button Best Practices:
 *
 * Use `type` (`ButtonType`) and `size` (`ButtonSize`) to set size and style. We should have a bounded
 * number of button types, as defined in Figma. Avoid adding colors to the component below directly.
 *
 * In this way, if we need a button, we know we can usually rely on Button. And we have a menu of button
 * options to choose from.
 *
 * TODO: The figma spec provides for a pre-label and post-label icon. Add that when needed.
 */
export const Button = ({
    children,
    onClick,
    isSubmit,
    disabled,
    type = "primary",
    size = "base",
    fullWidth,
    isLoading,
    className = "",
    href = "#",
    target,
    isExternal,
    title,
    dataTestId,
}: ButtonProps) => {
    const baseClass = "inline-block text-center no-underline";
    const widthClass = fullWidth ? "w-full" : "";
    const typeClass = TYPE_CLASS[type][disabled ? "disabled" : "enabled"];
    const cursorClass = disabled ? "cursor-not-allowed" : "cursor-pointer";

    const standardClass = `${baseClass} ${SIZE_CLASS[size]} ${widthClass} ${typeClass} ${cursorClass} ${className}`;
    const iconClass = `${baseClass} ${typeClass} ${cursorClass} ${className}`;
    const buttonClass = type === "icon" ? iconClass : standardClass;

    const buttonContents = () => {
        if (type === "icon") return children;
        return (
            <div className="flex select-none items-center justify-center gap-2 font-semibold">
                {isLoading && <Loader size="xs" hideTrack />}
                <Text
                    className="flex items-center gap-2"
                    size={TEXT_SIZE[size]}
                    span
                >
                    {children}
                </Text>
            </div>
        );
    };

    if (isSubmit || onClick || disabled) {
        return (
            <button
                onClick={onClick}
                type={isSubmit ? "submit" : "button"}
                className={buttonClass}
                disabled={disabled}
                title={title}
                data-testid={dataTestId}
            >
                {buttonContents()}
            </button>
        );
    }

    if (isExternal) {
        return (
            <a
                className={buttonClass}
                href={href}
                rel="noopener noreferrer"
                target={target}
                title={title}
                data-testid={dataTestId}
            >
                {buttonContents()}
            </a>
        );
    }

    return (
        <Link
            to={href}
            className={buttonClass}
            target={target}
            data-testid={dataTestId}
            title={title}
        >
            {buttonContents()}
        </Link>
    );
};

export default Button;
