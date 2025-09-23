import { animated, useSpring } from "@react-spring/web";

import { formatThousands } from "@/lib/formatNumber";

const getDecimals = (formatted: string): number =>
    formatted.includes(".") ? formatted.split(".")[1].length : 0;

export const AnimateNumber = ({
    n,
    precision,
    className,
    onClick,
}: {
    n: number;
    precision: number;
    className?: string;
    onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) => {
    const { number } = useSpring({
        from: { number: 0 },
        number: n,
        delay: 10,
        config: { mass: 1, tension: 300, friction: 50 },
    });

    const finalPrecision = getDecimals(formatThousands(n, precision));

    const numbers = () => {
        return (
            <animated.span className={className}>
                {number.to((animatedNumber) =>
                    formatThousands(animatedNumber, finalPrecision),
                )}
            </animated.span>
        );
    };

    if (!onClick) return numbers();

    return (
        <button onClick={onClick} className={className}>
            {numbers()}
        </button>
    );
};
