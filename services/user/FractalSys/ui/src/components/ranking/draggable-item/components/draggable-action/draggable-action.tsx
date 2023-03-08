import React, { forwardRef, CSSProperties } from "react";
import classNames from "classnames";

import "./draggable-action.css";

export interface Props extends React.HTMLAttributes<HTMLButtonElement> {
    active?: {
        fill: string;
        background: string;
    };
    dragging?: boolean;
}

export const DraggableAction = forwardRef<HTMLButtonElement, Props>(
    ({ active, className, dragging, style, ...props }, ref) => {
        return (
            <button
                ref={ref}
                {...props}
                className={classNames(
                    "dnd-action",
                    "flex h-full w-3 touch-none items-center justify-center rounded px-[15px]",
                    className
                )}
                tabIndex={0}
                style={
                    {
                        ...style,
                        "--fill": active?.fill,
                        "--background": active?.background,
                    } as CSSProperties
                }
            />
        );
    }
);
