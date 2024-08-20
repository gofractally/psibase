import { EaseIn } from "@/components/EaseIn";
import { MenuContent } from "@/components/menu-content";
import { ReactNode } from "react";

export const SetupWrapper = ({ children }: { children: ReactNode }) => {
    return (
        <div className="mx-auto flex h-dvh max-w-screen-xl flex-col">
            <div className="flex w-full flex-row-reverse  p-4">
                <div className="flex gap-2">
                    <MenuContent condense />
                </div>
            </div>
            <div className="flex-1">{children}</div>
        </div>
    );
};
