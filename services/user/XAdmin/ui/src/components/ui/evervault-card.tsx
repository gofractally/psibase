/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMotionValue } from "framer-motion";
import { useState, useEffect } from "react";
import { useMotionTemplate, motion } from "framer-motion";
import { cn } from "@shared/lib/utils";

export const EvervaultCard = ({
    text,
    className,
    gradient,
    onClick,
    chars,
}: {
    onClick: () => void;
    text?: string;
    className?: string;
    gradient?: string;
    chars?: string;
}) => {
    const mouseX = useMotionValue(0);
    const mouseY = useMotionValue(0);

    const [randomString, setRandomString] = useState("");

    useEffect(() => {
        const str = generateRandomString(1500, chars);
        setRandomString(str);
    }, []);

    function onMouseMove({ currentTarget, clientX, clientY }: any) {
        const { left, top } = currentTarget.getBoundingClientRect();
        mouseX.set(clientX - left);
        mouseY.set(clientY - top);

        const str = generateRandomString(1500, chars);
        setRandomString(str);
    }

    return (
        <button
            onClick={() => onClick()}
            className={cn(
                "group relative flex aspect-square  h-full w-full items-center justify-center bg-transparent p-0.5",
                className
            )}
        >
            <div
                onMouseMove={onMouseMove}
                className="group/card relative flex h-full w-full items-center justify-center overflow-hidden rounded-3xl bg-transparent"
            >
                <CardPattern
                    gradient={gradient}
                    mouseX={mouseX}
                    mouseY={mouseY}
                    randomString={randomString}
                />
                <div className="relative z-10 flex items-center justify-center">
                    <div className="relative flex h-44  w-44 items-center justify-center rounded-full text-4xl  text-white">
                        <div className="absolute h-full w-full rounded-full bg-white/[0.8] blur-sm dark:bg-black/[0.8]" />
                        <span className="z-20 text-center text-muted-foreground group-hover:text-primary">
                            {text}
                        </span>
                    </div>
                </div>
            </div>
        </button>
    );
};

export function CardPattern({ mouseX, mouseY, randomString, gradient }: any) {
    const maskImage = useMotionTemplate`radial-gradient(250px at ${mouseX}px ${mouseY}px, white, transparent)`;
    const style = { maskImage, WebkitMaskImage: maskImage };

    return (
        <div className="pointer-events-none">
            <div className="absolute inset-0 rounded-2xl  [mask-image:linear-gradient(white,transparent)] group-hover/card:opacity-50"></div>
            <motion.div
                className={cn(
                    "absolute inset-0 rounded-2xl bg-gradient-to-r  opacity-0  backdrop-blur-xl transition duration-500 group-hover/card:opacity-100",
                    gradient
                )}
                style={style}
            />
            <motion.div
                className="absolute inset-0 rounded-2xl opacity-0 mix-blend-overlay  group-hover/card:opacity-100"
                style={style}
            >
                <p className="absolute inset-x-0 h-full whitespace-pre-wrap break-words font-mono text-xs  text-white transition duration-500">
                    {randomString}
                </p>
            </motion.div>
        </div>
    );
}

export const generateRandomString = (
    length: number,
    characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
) => {
    let result = "";
    for (let i = 0; i < length; i++) {
        result += characters.charAt(
            Math.floor(Math.random() * characters.length)
        );
    }
    return result;
};

export const Icon = ({ className, ...rest }: any) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth="1.5"
        stroke="currentColor"
        className={className}
        {...rest}
    >
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m6-6H6" />
    </svg>
);
