import iconAccountDesktop from "./images/app-account-desktop.svg";
import iconAccountMobile from "./images/app-account-mobile.svg";
import iconExploreDesktop from "./images/app-explore-desktop.svg";
import iconExploreMobile from "./images/app-explore-mobile.svg";
import iconWalletDesktop from "./images/app-wallet-desktop.svg";
import iconWalletMobile from "./images/app-wallet-mobile.svg";

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
    mobileIcon: string;
    desktopIcon: string;
};

export const applets: AppletEntry[] = [
    {
        title: "Account creation",
        description: "Create a new account. Only available on testnet.",
        service: "account-sys",
        mobileIcon: iconAccountMobile,
        desktopIcon: iconAccountDesktop,
    },
    {
        title: "Account management",
        description: "Used to manage your existing accounts.",
        service: "auth-ec-sys",
        mobileIcon: iconExploreMobile,
        desktopIcon: iconExploreDesktop,
    },
    {
        title: "Block explorer",
        description:
            "View the most recently produced blocks, all the way back to the beginning of the chain.",
        service: "explore-sys",
        mobileIcon: iconExploreMobile,
        desktopIcon: iconExploreDesktop,
    },
    {
        title: "Wallet",
        description:
            "View your balance, send/swap tokens, other standard wallet functionality.",
        service: "token-sys",
        mobileIcon: iconWalletMobile,
        desktopIcon: iconWalletDesktop,
    },
];

export default { appletPrefix, applets, AppletStates };
