import { cn } from "@shared/lib/utils";

export const AccountName = ({ type, children }: { type: "app" | "account", children: string }) => {
    const className = cn("border pt-0.5 px-[3px] pb-px rounded-[3px] border-[#e8e8e821] font-mono bg-[#e8e8e80a] text-[#e8912d] leading-1.5 font-extralight text-[85%]", {
        "text-[#e8912d]": type === "app",
        "text-foreground": type === "account",
    });
    return (
        <span className={className}>
            {children}
        </span>
    );
};