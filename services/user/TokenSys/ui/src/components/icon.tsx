import { FC, SVGProps } from "react";

import { ArrowUpSolid, Incoming, Loader, Outgoing } from "./icons";

export type IconProps = {
    type: IconType;
    size?: IconSize;
    iconStyle?: IconStyle;
    className?: string;
};

export type IconSize =
    | "2xs"
    | "xs"
    | "sm"
    | "base"
    | "lg"
    | "xl"
    | "2xl"
    | "3xl"
    | "4xl"
    | "unset";
const SIZES: { [key in IconSize]: string } = {
    "2xs": "w-3 h-3",
    xs: "w-4 h-4",
    sm: "w-5 h-5",
    base: "w-6 h-6",
    lg: "w-8 h-8",
    xl: "w-9 h-9",
    "2xl": "w-10 h-10",
    "3xl": "w-14 h-14",
    "4xl": "w-[72px] h-[72px]",
    unset: "",
};

export type IconType = "arrow-up" | "incoming" | "loading" | "outgoing";

type Icon = {
    [key in IconType]:
        | FC<SVGProps<SVGSVGElement>>
        | {
              outline: FC<SVGProps<SVGSVGElement>>;
              solid: FC<SVGProps<SVGSVGElement>>;
          };
};

const ICONS: Icon = {
    "arrow-up": ArrowUpSolid,
    incoming: Incoming,
    loading: Loader,
    outgoing: Outgoing,
};

export type IconStyle = "solid" | "outline";

/**
 * Icons should be selected from our [design system](https://www.figma.com/file/nKp13nMbOKwtvUSuNaQk0A/%C6%92SYSTEM-UX?node-id=56%3A3079)
 * when possible--which includes all HeroIcons and custom icons (solid and outline).
 */
export const Icon = ({
    type,
    className = "",
    size = "unset",
    iconStyle = "outline",
}: IconProps) => {
    const icon = ICONS[type];
    let IconComponent: FC<SVGProps<SVGSVGElement>>;
    if ("outline" in icon || "solid" in icon) {
        IconComponent = icon[iconStyle];
    } else {
        IconComponent = icon;
    }
    const sizeClass = SIZES[size] || "";
    const iconClass = `flex-no-shrink ${sizeClass} ${className}`;
    return <IconComponent className={iconClass} />;
};

export default Icon;
