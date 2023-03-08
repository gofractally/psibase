import React from "react";

import Button from "./Button";
import Text from "./Text";
import Icon, { IconStyle, IconType } from "./Icon";
import Container from "./Container";

export interface AlertBannerProps {
    hasCloseButton?: boolean;
    iconType?: IconType;
    iconStyle?: IconStyle;
    onDismiss?: () => void;
    className?: string;
    children: React.ReactNode;
}

export const AlertBanner = ({
    hasCloseButton = false,
    iconType,
    iconStyle = "outline",
    onDismiss,
    className = "",
    children,
}: AlertBannerProps) => {
    const layoutClass = "py-3 flex justify-between items-center gap-3";
    const colorClass = "bg-gray-700 text-white";
    const containerClass = `${layoutClass} ${colorClass} ${className}`;

    const dismiss = (e: React.MouseEvent) => {
        e.stopPropagation();
        onDismiss?.();
    };

    return (
        <Container className={containerClass}>
            <div className="min-h-8 flex items-center gap-4">
                {iconType && (
                    <div className="hidden sm:block">
                        <Icon type={iconType} size="lg" iconStyle={iconStyle} />
                    </div>
                )}
                <Text span size="base" className="select-none font-medium">
                    {children}
                </Text>
            </div>
            {hasCloseButton && (
                <Button
                    type="icon"
                    className="text-white hover:text-gray-400"
                    onClick={dismiss}
                >
                    <Icon type="close" size="lg" iconStyle="outline" />
                </Button>
            )}
        </Container>
    );
};

export default AlertBanner;
