import React from "react";
import { IconType } from "./Icon";
import Text from "./Text";
import Hexicon from "./Hexicon";

export interface ActionButtonProps {
    label?: string;
    onClick?: (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void;
    icon: IconType;
    disabled?: boolean;
    isLoading?: boolean;
    dataTestId?: string;
}

export const ActionButton = ({
    label,
    onClick,
    icon,
    disabled,
    isLoading,
    dataTestId,
}: ActionButtonProps) => {
    if (isLoading || disabled) {
        const buttonClass = disabled
            ? "text-gray-400 cursor-not-allowed"
            : "text-gray-600";
        return (
            <button
                className={`select-none font-semibold ${buttonClass}`}
                disabled
            >
                <span className="flex flex-col items-center justify-center">
                    <Hexicon
                        iconType={isLoading ? "loading" : icon}
                        iconClass={isLoading ? "animate-spin" : ""}
                        bgColorClass={disabled ? "bg-gray-100" : "bg-gray-200"}
                        iconShade="dark"
                    />
                    <Text span size="xs">
                        {label}
                    </Text>
                </span>
            </button>
        );
    }

    return (
        <button
            className="select-none font-semibold text-gray-600"
            onClick={onClick}
            type="button"
            disabled={disabled}
            title={label}
            data-testid={dataTestId}
        >
            <span className="group flex flex-col items-center justify-center">
                <Hexicon
                    iconType={icon}
                    bgColorClass="bg-gray-200 group-hover:bg-gray-300"
                    iconShade="dark"
                />
                <Text span size="xs">
                    {label}
                </Text>
            </span>
        </button>
    );
};

export default ActionButton;
