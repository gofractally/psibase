import { FC, SVGProps } from "react";
import IconAccountDesktop from "./images/app-account-desktop.svg";
import IconAccountMobile from "./images/app-account-mobile.svg";
import IconExploreDesktop from "./images/app-explore-desktop.svg";
import IconExploreMobile from "./images/app-explore-mobile.svg";
import IconWalletDesktop from "./images/app-wallet-desktop.svg";
import IconWalletMobile from "./images/app-wallet-mobile.svg";

export const appletPrefix = "/applet/";

export const AppletStates = {
    primary: 0,
    headless: 1,
    modal: 2,
};

export type AppletEntry = {
    title: string;
    description: string;
    service: string;
    MobileIcon: FC<SVGProps<SVGSVGElement>>;
    DesktopIcon: FC<SVGProps<SVGSVGElement>>;
    requiresUser: boolean;
};

export const applets: AppletEntry[] = [
    {
        title: "Account creation",
        description: "Create a new account. Only available on testnet.",
        service: "account-sys",
        MobileIcon: IconAccountMobile,
        DesktopIcon: IconAccountDesktop,
        requiresUser: false,
    },
    {
        title: "Account management",
        description: "Used to manage your existing accounts.",
        service: "auth-ec-sys",
        MobileIcon: IconExploreMobile,
        DesktopIcon: IconExploreDesktop,
        requiresUser: false,
    },
    {
        title: "Block explorer",
        description:
            "View the most recently produced blocks, all the way back to the beginning of the chain.",
        service: "explore-sys",
        MobileIcon: IconExploreMobile,
        DesktopIcon: IconExploreDesktop,
        requiresUser: false,
    },
    {
        title: "Wallet",
        description:
            "View your balance, send/swap tokens, other standard wallet functionality.",
        service: "token-sys",
        MobileIcon: IconWalletMobile,
        DesktopIcon: IconWalletDesktop,
        requiresUser: true,
    },
];

export default { appletPrefix, applets, AppletStates };
