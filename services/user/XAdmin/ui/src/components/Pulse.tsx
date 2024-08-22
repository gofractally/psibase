import { cn } from "@/lib/utils";

interface PulseProps {
    color: "green" | "red" | "yellow";
}

export const Pulse = ({ color = "green" }: PulseProps) => (
    <span className="relative flex h-3 w-3">
        <span
            className={cn(
                "absolute inline-flex h-full w-full  rounded-full  opacity-75",
                {
                    "bg-green-400": color == "green",
                    "bg-red-400": color == "red",
                    "bg-orange-400": color == "yellow",
                    "animate-ping": color !== "red",
                }
            )}
        ></span>
        <span
            className={cn("relative inline-flex h-3 w-3 rounded-full", {
                "bg-green-500": color == "green",
                "bg-red-500": color == "red",
                "bg-orange-400": color == "yellow",
            })}
        ></span>
    </span>
);
