import { useNavigate } from "react-router-dom";

import { siblingUrl } from "@psibase/common-lib";

import { HoverBorderGradient } from "@shared/components/hover-border-gradient";

import { AccountSwitcher } from "./account-switcher";
import { ModeToggle } from "./mode-toggle";

function HoverBorderGradientDemo() {
    return (
        <div className=" flex justify-center text-center">
            <HoverBorderGradient
                as="div"
                containerClassName="rounded-full"
                className="flex items-center space-x-2 bg-white text-black dark:bg-black dark:text-white"
            >
                <span>psibase</span>
            </HoverBorderGradient>
        </div>
    );
}

export const Nav = ({ title }: { title?: string }) => {
    const home = siblingUrl();
    const navigate = useNavigate();
    return (
        <div className="mt-4 flex w-full justify-between px-2">
            <a href={home}>
                <HoverBorderGradientDemo />
            </a>
            {title && (
                <div
                    onClick={() => {
                        navigate("/");
                    }}
                    className="flex flex-col justify-center text-2xl font-semibold"
                >
                    {title}
                </div>
            )}
            <div className="flex items-center gap-2">
                <AccountSwitcher />
                <ModeToggle />
            </div>
        </div>
    );
};
