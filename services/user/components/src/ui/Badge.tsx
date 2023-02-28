import React from "react";

export interface BadgeProps {
    value: string;
    disabled?: boolean;
    className?: string;
}

/**
 * The `<Badge />` component renders a rounded corner badge with white text on black background
 */
export const Badge = ({
    value,
    disabled = false,
    className = "",
}: BadgeProps) => {
    const bgColor = disabled ? "bg-gray-400" : "bg-gray-900";
    const cls = `${bgColor} animate-bounce rounded-3xl px-3 py-0.5 select-none text-white font-mono text-sm ${className}`;
    return <span className={cls}>{value}</span>;
};

export default Badge;
