import { HoverBorderGradient } from "@/components/ui/hover-border-gradient";
import { SettingsDropdown } from "@/components/settings-dropdown";
import { siblingUrl } from "@psibase/common-lib";
import { useBranding } from "@/hooks/network/useBranding";

function HoverBorderGradientDemo() {
  const { data: networkName } = useBranding();
  return (
    <div className=" flex justify-center text-center">
      <HoverBorderGradient
        as="div"
        containerClassName="rounded-full"
        className="flex items-center space-x-2 bg-white text-black dark:bg-black dark:text-white"
      >
        <span>{networkName || "Network"}</span>
      </HoverBorderGradient>
    </div>
  );
}

export const Nav = ({ title }: { title?: string }) => {
  const home = siblingUrl();
  return (
    <div className="mt-4 flex w-full justify-between px-2">
      <a href={home}>
        <HoverBorderGradientDemo />
      </a>
      {title && (
        <div className="flex flex-col justify-center font-xl font-semibold">
          {title}
        </div>
      )}
      <div>
        <SettingsDropdown />
      </div>
    </div>
  );
};
