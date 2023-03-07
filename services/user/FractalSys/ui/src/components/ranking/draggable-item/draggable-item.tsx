import React from "react";
import type {
    DraggableSyntheticListeners,
    UniqueIdentifier,
} from "@dnd-kit/core";
import type { Transform } from "@dnd-kit/utilities";

export interface Props {
    disabled?: boolean;
    dragOverlay?: boolean;
    dragging?: boolean;
    fadeIn?: boolean;
    handle?: boolean;
    handleProps?: any;
    height?: number;
    index?: number;
    listeners?: DraggableSyntheticListeners;
    onRemove?(): void;
    sorting?: boolean;
    style?: React.CSSProperties;
    transform?: Transform | null;
    transition?: string | null;
    value: UniqueIdentifier;
    wrapperStyle?: React.CSSProperties;
}

export interface DraggableItemRenderProps extends Props {
    disabled: boolean;
    dragOverlay: boolean;
    dragging: boolean;
    fadeIn: boolean;
    handle: boolean;
    sorting: boolean;
    ref: React.Ref<HTMLElement>;
}

/**
 * This component memoizes the Item and transforms optional props to required.
 */
export const DraggableItem = React.memo(
    React.forwardRef<
        HTMLElement,
        Props & {
            renderItem(args: DraggableItemRenderProps): React.ReactElement;
        }
    >(({ renderItem, ...props }, ref) => {
        return renderItem({
            ...props,
            disabled: Boolean(props.disabled),
            dragOverlay: Boolean(props.dragOverlay),
            dragging: Boolean(props.dragging),
            fadeIn: Boolean(props.fadeIn),
            handle: Boolean(props.handle),
            sorting: Boolean(props.sorting),
            ref,
        });
    })
);
