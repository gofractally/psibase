import { HoverBorderGradient } from "@/components/ui/hover-border-gradient";
import { SettingsDropdown } from "@/components/settings-dropdown";

function HoverBorderGradientDemo() {
    return (
        <div className="flex justify-center text-center select-none">
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
        <div className="container mx-auto flex p-6 justify-between items-center">
        {/* <div className="mt-4 flex w-full justify-between"> */}
            <HoverBorderGradientDemo />
            <SettingsDropdown />
        </div>
    );
};
