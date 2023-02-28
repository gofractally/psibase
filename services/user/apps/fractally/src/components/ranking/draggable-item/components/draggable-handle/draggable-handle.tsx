import { forwardRef } from "react";
import classNames from "classnames";
import { Icon } from "@toolbox/components/ui";

import { DraggableAction, DraggableActionProps } from "../draggable-action";

export const DraggableHandle = forwardRef<
    HTMLButtonElement,
    DraggableActionProps
>((props, ref) => {
    return (
        <DraggableAction
            ref={ref}
            data-cypress="draggable-handle"
            className={classNames({
                "cursor-grabbing": props.dragging,
                "cursor-grab": !props.dragging,
            })}
            {...props}
        >
            <Icon type="drag-handle" size="xs" className="text-gray-400" />
        </DraggableAction>
    );
});
