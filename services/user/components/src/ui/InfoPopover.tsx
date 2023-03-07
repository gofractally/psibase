import React, { useState } from "react";
import { Popover, ArrowContainer, PopoverPosition } from "react-tiny-popover";
import { Container, Icon, Button } from ".";
import "../styles/popover.css";

interface ToggleCallback {
    (): void;
}

export type TriggerRenderer = (toggle: ToggleCallback) => JSX.Element;

export interface PopoverProps {
    trigger: TriggerRenderer;
    title?: string;
    children?: React.ReactNode;
    html?: string;
    positionTo?: PopoverPosition;
}

export const InfoPopover = ({
    trigger,
    title,
    children,
    html,
    positionTo,
}: PopoverProps) => {
    const [isPopoverOpen, setIsPopoverOpen] = useState(false);
    const toggle = () => {
        setIsPopoverOpen(!isPopoverOpen);
    };
    let positions;
    if (positionTo) positions = [positionTo];
    return (
        <Popover
            isOpen={isPopoverOpen}
            onClickOutside={() => setIsPopoverOpen(false)}
            positions={positions}
            content={({ position, childRect, popoverRect }) => (
                <ArrowContainer
                    className="drop-shadow-md"
                    position={position}
                    childRect={childRect}
                    popoverRect={popoverRect}
                    arrowColor="#1E293B"
                    arrowSize={10}
                >
                    <Container className="PopoverPanel max-w-lg bg-gray-800 text-left text-sm font-normal text-white drop-shadow-md ">
                        <div>
                            <Button
                                className="float-right"
                                type="icon"
                                onClick={() => setIsPopoverOpen(false)}
                            >
                                <Icon
                                    type="close"
                                    size="sm"
                                    iconStyle="outline"
                                />
                            </Button>
                            {title && (
                                <div className="grow font-semibold text-white">
                                    {title}
                                </div>
                            )}
                        </div>
                        {html && (
                            <div
                                className="PopoverContent text-gray-300"
                                dangerouslySetInnerHTML={{ __html: html }}
                            />
                        )}
                        {children}
                        <div className="flex">
                            <div className="flex-1" />
                            <a
                                href="#"
                                className="mr-6 px-1 py-2 text-gray-200 hover:text-white"
                                onClick={() => setIsPopoverOpen(false)}
                            >
                                Close
                            </a>
                        </div>
                    </Container>
                </ArrowContainer>
            )}
        >
            {trigger(toggle)}
        </Popover>
    );
};
