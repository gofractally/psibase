import React, { FC, SVGProps } from "react";
import {
    ArrowCircleLeftIcon as ArrowCircleLeftIconSolid,
    BellIcon as BellIconSolid,
    ChartSquareBarIcon as ChartSquareBarIconSolid,
    ClipboardIcon as ClipboardIconSolid,
    CogIcon as CogIconSolid,
    DocumentDuplicateIcon,
    FireIcon,
    HomeIcon as HomeIconSolid,
    MenuIcon,
    ServerIcon,
    SparklesIcon,
    XCircleIcon as XCircleIconSolid,
    PlusIcon,
    PresentationChartBarIcon,
} from "@heroicons/react/solid";
import {
    ArrowCircleLeftIcon as ArrowCircleLeftIconOutline,
    ArrowSmUpIcon,
    BellIcon as BellIconOutline,
    ChartSquareBarIcon as ChartSquareBarIconOutline,
    CheckIcon,
    ClipboardIcon as ClipboardIconOutline,
    CogIcon as CogIconOutline,
    HomeIcon as HomeIconOutline,
    LogoutIcon,
    MenuAlt4Icon,
    PencilAltIcon,
    SearchIcon,
    SwitchVerticalIcon,
    TrashIcon,
    XCircleIcon as XCircleIconOutline,
    XIcon,
    RefreshIcon,
    UserAddIcon,
    LoginIcon,
    ChevronDownIcon,
    ChevronUpIcon,
    ChevronRightIcon,
    MicrophoneIcon,
    InformationCircleIcon,
    ExclamationIcon,
    ArrowCircleUpIcon,
} from "@heroicons/react/outline";


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

export type IconType =
    | "back"
    | "btc"
    | "camera"
    | "check"
    | "chevron-right"
    | "clipboard"
    | "close"
    | "cog"
    | "copy"
    | "drag-handle"
    | "drawUp"
    | "edit"
    | "f"
    | "fire"
    | "hexagon"
    | "home"
    | "info"
    | "loading"
    | "menu"
    | "notification"
    | "search"
    | "send"
    | "server"
    | "signOut"
    | "sparkles"
    | "stats"
    | "swap"
    | "trash"
    | "user-hex"
    | "x"
    | "refresh"
    | "login"
    | "signup"
    | "close-down"
    | "microphone"
    | "mic-off"
    | "consensus-full"
    | "consensus-without-me"
    | "no-consensus"
    | "camera-off"
    | "exclamation"
    | "circle-up"
    | "respect"
    | "plus"
    | "presentation";

type Icon = {
    [key in string]:
        | FC<SVGProps<SVGSVGElement>>
        | {
              outline: FC<SVGProps<SVGSVGElement>>;
              solid: FC<SVGProps<SVGSVGElement>>;
          };
};

const ICONS: Icon = {
    back: {
        solid: ArrowCircleLeftIconSolid,
        outline: ArrowCircleLeftIconOutline,
    },
    check: CheckIcon,
    "chevron-right": ChevronRightIcon,
    clipboard: { solid: ClipboardIconSolid, outline: ClipboardIconOutline },
    close: { solid: XCircleIconSolid, outline: XCircleIconOutline },
    cog: { solid: CogIconSolid, outline: CogIconOutline },
    copy: DocumentDuplicateIcon,
    "drag-handle": MenuAlt4Icon,
    drawUp: ChevronUpIcon,
    edit: PencilAltIcon,
    fire: FireIcon,
    home: { solid: HomeIconSolid, outline: HomeIconOutline },
    info: InformationCircleIcon,
    menu: MenuIcon,
    notification: { outline: BellIconOutline, solid: BellIconSolid },
    search: SearchIcon,
    send: ArrowSmUpIcon,
    server: ServerIcon,
    signOut: LogoutIcon,
    sparkles: SparklesIcon,
    stats: {
        solid: ChartSquareBarIconSolid,
        outline: ChartSquareBarIconOutline,
    },
    swap: SwitchVerticalIcon,
    trash: TrashIcon,
    x: XIcon,
    refresh: RefreshIcon,
    login: LoginIcon,
    signup: UserAddIcon,
    "close-down": ChevronDownIcon,
    microphone: MicrophoneIcon,
    plus: PlusIcon,
    exclamation: ExclamationIcon,
    "circle-up": ArrowCircleUpIcon,
    presentation: PresentationChartBarIcon,
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
