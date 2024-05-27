import { formatThousands } from "@/lib/formatNumber";
import { useSpring, animated } from "react-spring";

export const AnimateNumber = ({
  n,
  precision,
}: {
  n: number;
  precision: number;
}) => {
  console.log({ precision });
  const { number } = useSpring({
    from: { number: 0 },
    number: n,
    delay: 10,
    config: { mass: 1.8, tension: 170, friction: 26 },
  });

  return (
    <animated.span>
      {number.to((animatedNumber) =>
        animatedNumber == n
          ? formatThousands(animatedNumber, precision)
          : formatThousands(animatedNumber, 0)
      )}
    </animated.span>
  );
};
