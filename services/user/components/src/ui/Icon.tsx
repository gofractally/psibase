import React, { FC, SVGProps } from "react";

import {
    ArrowCircleLeftIcon as ArrowCircleLeftIconOutline,
    ArrowCircleUpIcon,
    ArrowSmUpIcon,
    BellIcon as BellIconOutline,
    ChartSquareBarIcon as ChartSquareBarIconOutline,
    CheckIcon,
    ChevronDownIcon,
    ChevronRightIcon,
    ChevronUpIcon,
    ClipboardIcon as ClipboardIconOutline,
    CogIcon as CogIconOutline,
    ExclamationIcon,
    HomeIcon as HomeIconOutline,
    InformationCircleIcon,
    LoginIcon,
    LogoutIcon,
    MenuAlt4Icon,
    MicrophoneIcon,
    PencilAltIcon,
    RefreshIcon,
    SearchIcon,
    SwitchVerticalIcon,
    TrashIcon,
    UserAddIcon,
    XCircleIcon as XCircleIconOutline,
    XIcon,
} from "@heroicons/react/outline";
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
    PlusIcon,
    PresentationChartBarIcon,
    ServerIcon,
    SparklesIcon,
    XCircleIcon as XCircleIconSolid,
} from "@heroicons/react/solid";

import {
    ArrowUpSolid,
    BTC,
    Camera,
    CameraOff,
    ConsensusFull,
    ConsensusWithoutMe,
    EOS,
    F,
    Hexagon,
    Loader,
    MicOff,
    NoConsensus,
    Respect,
    UserHex,
} from "./assets/icons";

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
    | "arrow-up"
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
    | "eos"
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
    [key in IconType]:
        | FC<SVGProps<SVGSVGElement>>
        | {
              outline: FC<SVGProps<SVGSVGElement>>;
              solid: FC<SVGProps<SVGSVGElement>>;
          };
};

const ICONS: Icon = {
    "arrow-up": ArrowUpSolid,
    back: {
        solid: ArrowCircleLeftIconSolid,
        outline: ArrowCircleLeftIconOutline,
    },
    btc: BTC,
    camera: Camera,
    check: CheckIcon,
    "chevron-right": ChevronRightIcon,
    clipboard: { solid: ClipboardIconSolid, outline: ClipboardIconOutline },
    close: { solid: XCircleIconSolid, outline: XCircleIconOutline },
    cog: { solid: CogIconSolid, outline: CogIconOutline },
    copy: DocumentDuplicateIcon,
    "drag-handle": MenuAlt4Icon,
    drawUp: ChevronUpIcon,
    edit: PencilAltIcon,
    eos: EOS,
    f: F,
    fire: FireIcon,
    hexagon: Hexagon,
    home: { solid: HomeIconSolid, outline: HomeIconOutline },
    info: InformationCircleIcon,
    loading: Loader,
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
    "user-hex": UserHex,
    x: XIcon,
    refresh: RefreshIcon,
    login: LoginIcon,
    signup: UserAddIcon,
    "close-down": ChevronDownIcon,
    microphone: MicrophoneIcon,
    "mic-off": MicOff,
    "consensus-full": ConsensusFull,
    "consensus-without-me": ConsensusWithoutMe,
    "no-consensus": NoConsensus,
    "camera-off": CameraOff,
    plus: PlusIcon,
    exclamation: ExclamationIcon,
    "circle-up": ArrowCircleUpIcon,
    respect: Respect,
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
