import { siblingUrl } from "@psibase/common-lib";

import { HoverBorderGradient } from "@shared/components/hover-border-gradient";

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

export const Nav = () => {
    return (
        <div className="mt-4 flex w-full justify-between">
            <a href={siblingUrl()}>
                <HoverBorderGradientDemo />
            </a>
            <div></div>
        </div>
    );
};
