import { formatThousands } from "@/lib/formatNumber";
import { useSpring, animated } from "@react-spring/web";

const getDecimals = (formatted: string): number =>
  formatted.includes(".") ? formatted.split(".")[1].length : 0;

export const AnimateNumber = ({
  n,
  precision,
}: {
  n: number;
  precision: number;
}) => {
  const { number } = useSpring({
    from: { number: 0 },
    number: n,
    delay: 10,
    config: { mass: 1, tension: 300, friction: 50 },
  });

  const finalPrecision = getDecimals(formatThousands(n, precision));

  return (
    <animated.span>
      {number.to((animatedNumber) =>
        formatThousands(animatedNumber, finalPrecision)
      )}
    </animated.span>
  );
};
