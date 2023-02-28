import React from "react";

import { Button, Heading, Icon } from ".";

export interface ModalNavProps {
    title?: string;
    leftButton?: "close" | "back" | null;
    rightButton?: "close" | "search" | null;
    onClickLeftButton?: () => void;
}

/**
 *
 * The search functionality in this component (in Figma) has yet to be implemented.
 */
export const ModalNav = ({
    title,
    leftButton,
    rightButton,
    onClickLeftButton,
}: ModalNavProps) => {
    return (
        <div className="flex select-none font-semibold text-gray-500">
            <div className="w-8">
                {leftButton && (
                    <Button type="icon" onClick={onClickLeftButton}>
                        <Icon type={leftButton} size="lg" iconStyle="outline" />
                    </Button>
                )}
            </div>
            <Heading
                tag="h2"
                styledAs="h6"
                className="flex h-8 flex-1 items-center justify-center"
            >
                {title}
            </Heading>
            <div className="w-8 sm:relative sm:left-1">
                {rightButton && (
                    <Button type="icon" onClick={onClickLeftButton}>
                        <Icon
                            type={rightButton}
                            size="lg"
                            iconStyle="outline"
                        />
                    </Button>
                )}
            </div>
        </div>
    );
};

export default ModalNav;
