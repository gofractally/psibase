import React, { forwardRef } from "react";

export interface CardProps {
    className?: string;
    children: React.ReactNode;
}

/**
 * A `<Card />` places a white containing box on the canvas. It is concerned
 * more with colors and style than with spacing. It has no padding or margin. For
 * that, nest `<Container />` components within it.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>((props, ref) => {
    const { children, className, ...rest } = props;
    return (
        <div
            className={`border-b border-gray-100 bg-white ${className}`}
            ref={ref}
            {...rest}
        >
            {children}
        </div>
    );
});

export default Card;
