import React, { forwardRef } from "react";
import classNames from "classnames";

import RankContainerHeader from "../rank-container-header";
import "./draggable-container.css";

export interface Props {
    children: React.ReactNode;
    label?: string;
    style?: React.CSSProperties;
    hover?: boolean;
    handleProps?: React.HTMLAttributes<any>;
    scrollable?: boolean;
    shadow?: boolean;
    placeholder?: boolean;
    onClick?(): void;
    onRemove?(): void;
}

export const DraggableContainer = forwardRef<
    HTMLDivElement & HTMLButtonElement,
    Props
>(
    (
        {
            children,
            label,
            handleProps,
            hover,
            onClick,
            onRemove,
            placeholder,
            style = {},
            scrollable,
            shadow,
            ...props
        }: Props,
        ref
    ) => {
        const Component = onClick ? "button" : "div";

        return (
            <Component
                {...props}
                ref={ref}
                style={style}
                className={classNames(
                    "dnd-container",
                    "flex appearance-none auto-rows-max flex-col overflow-hidden bg-gray-100 px-3 pb-2 outline-none",
                    { hover, shadow }
                )}
                onClick={onClick}
                tabIndex={onClick ? 0 : undefined}
            >
                <RankContainerHeader ranked={label === "ranked"} />
                {placeholder ? (
                    <Placeholder>{children}</Placeholder>
                ) : (
                    <div className="flex">
                        <div
                            className={classNames("mr-2 w-2 rounded", {
                                "bg-gray-200": label !== "ranked",
                                "bg-green-gradient": label === "ranked",
                            })}
                        />
                        <Items scrollable={scrollable}>{children}</Items>
                    </div>
                )}
            </Component>
        );
    }
);

const Items = ({
    scrollable,
    children,
}: {
    scrollable?: boolean;
    children: React.ReactNode;
}) => (
    <ul
        className={classNames("m-0 grid flex-1 list-none gap-1", {
            "overflow-y-auto": scrollable,
        })}
    >
        {children}
    </ul>
);

const Placeholder = ({ children }: { children: React.ReactNode }) => (
    <div className="flex h-[50px] cursor-pointer select-none items-center justify-center rounded border border-dashed border-gray-400 bg-white font-medium italic text-gray-400 hover:border-gray-400 hover:text-gray-500">
        {children}
    </div>
);
