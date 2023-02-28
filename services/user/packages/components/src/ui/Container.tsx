import React, { forwardRef } from "react";

export interface ContainerProps {
    className?: string;
    children?: React.ReactNode | React.ReactNode[];
}

/**
 * A `<Container />` provides a `div` with our standard padding. It is concerned
 * with spacing, not color/style. You will often see Containers within `<Card />`
 * components, although they often feature elsewhere.
 */
export const Container = forwardRef<HTMLDivElement, ContainerProps>(
    (props, ref) => {
        const { children, className, ...rest } = props;
        return (
            <div className={`p-4 ${className}`} ref={ref} {...rest}>
                {children}
            </div>
        );
    }
);

export default Container;
