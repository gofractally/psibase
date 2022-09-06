import React from "react";

/**
 * As we have a legitimate need for more types (e.g., note, info, danger, etc.),
 * we'll add them here. `TextType` would become a union type.
 */
export type TextType = "primary" | "secondary" | "danger" | "success";
const TYPES: { [key in TextType]: string } = {
    primary: "", // text-gray-900 is applied by default
    secondary: "text-gray-500",
    danger: "text-red-500",
    success: "text-green-500",
};

export type TextSize = "xs" | "sm" | "base" | "lg" | "inherit";
const SIZES: { [key in TextSize]: string } = {
    xs: "text-xs",
    sm: "text-sm",
    base: "text-base",
    lg: "text-lg",
    inherit: "",
};

export interface TextProps {
    children: React.ReactNode;
    type?: TextType;
    size?: TextSize;
    span?: boolean;
    className?: string;
    mono?: boolean;
}

/**
 * The `<Text />` component provides an opinionated interface for text (as paragraphs or spans).
 * As we have a legitimate need for more types (e.g., note, info, danger, etc.),
 * we'll add them. The default UI text size is `lg`.
 */
export const Text = ({
    children,
    className = "",
    type = "primary",
    size = "lg",
    span,
    mono,
}: TextProps) => {
    const textClass = `${TYPES[type]} ${SIZES[size]} ${className} ${
        mono ? "font-mono" : ""
    }`;

    if (span) return <span className={textClass}>{children}</span>;
    return <p className={textClass}>{children}</p>;
};

export default Text;
