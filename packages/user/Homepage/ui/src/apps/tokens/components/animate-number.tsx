import { useSpring } from "@react-spring/web";
import React, { useMemo, useRef } from "react";

import { formatThousands } from "@/apps/tokens/lib/format-number";

export const AnimateNumber = ({
    n,
    precision,
    useFullPrecision = false,
    className,
    onClick,
}: {
    n: number;
    precision: number;
    useFullPrecision?: boolean;
    className?: string;
    onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) => {
    // Calculate significant decimal places (trimming trailing zeros)
    const getSignificantDecimalPlaces = (num: number): number => {
        const str = num.toString();
        if (str.includes(".")) {
            const decimalPart = str.split(".")[1];
            // Find the last non-zero digit
            let lastSignificant = decimalPart.length;
            for (let i = decimalPart.length - 1; i >= 0; i--) {
                if (decimalPart[i] !== "0") {
                    lastSignificant = i + 1;
                    break;
                }
            }
            return lastSignificant;
        }
        return 0;
    };

    // Calculate spring precision based on the precision parameter and number's actual precision
    const desiredDecimalPlaces = useMemo(() => {
        if (useFullPrecision) {
            return precision;
        }
        return getSignificantDecimalPlaces(n);
    }, [n, precision, useFullPrecision]);

    // Returns "0.0001" for 4 decimal places and "0.01" for 2 decimal places
    const springPrecision = useMemo(() => {
        return Math.pow(10, -desiredDecimalPlaces);
    }, [desiredDecimalPlaces]);

    // Track the previous number to animate from
    const prevNumberRef = useRef(n);

    // Store the formatted value in state to prevent react-spring from converting it back to a number
    // (using <animated.span> will convert it back to a number and we'll lose trailing zeros on rerenders that don't retrigger the animation)
    const [displayValue, setDisplayValue] = React.useState(() =>
        formatThousands(n, desiredDecimalPlaces, true),
    );

    useSpring({
        from: { number: prevNumberRef.current },
        to: { number: n },
        delay: 10,
        config: {
            mass: 1,
            tension: 300,
            friction: 50,
            precision: springPrecision,
        },
        onChange: (result) => {
            const val = result.value.number;
            const formatted = formatThousands(val, desiredDecimalPlaces, true);
            setDisplayValue(formatted);
        },
        onRest: () => {
            // Update the previous value ref after animation completes
            prevNumberRef.current = n;
        },
    });

    const numbers = () => {
        return <span className={className}>{displayValue}</span>; // don't use <animated.span> here!
    };

    if (!onClick) return numbers();

    return (
        <button onClick={onClick} className={className} type="button">
            {numbers()}
        </button>
    );
};
