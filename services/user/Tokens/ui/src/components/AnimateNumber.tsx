import { formatThousands } from "@/lib/formatNumber";
import { useSpring, animated } from "react-spring";

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

  return (
    <animated.span>
      {number.to((animatedNumber) =>   formatThousands(animatedNumber, precision))}
    </animated.span>
  );
};
