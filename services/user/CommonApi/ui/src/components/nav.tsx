import { HoverBorderGradient } from "@/components/ui/hover-border-gradient";
import { SettingsDropdown } from "@/components/settings-dropdown";

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
            <div>
                <HoverBorderGradientDemo />
            </div>
            <div>
                <SettingsDropdown />
            </div>
        </div>
    );
};
