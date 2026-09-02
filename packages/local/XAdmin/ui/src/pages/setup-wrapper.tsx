import { ReactNode } from "react";

import { MenuContent } from "@/components/menu-content";

export const SetupWrapper = ({ children }: { children: ReactNode }) => {
    return (
        <div className="mx-auto flex h-dvh max-w-screen-xl flex-col">
            <div className="flex w-full justify-end p-4">
                <div className="flex gap-2">
                    <MenuContent condense />
                </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </div>
    );
};
