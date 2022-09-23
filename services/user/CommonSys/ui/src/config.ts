import { FC, SVGProps } from "react";
import IconAccountDesktop from "./images/app-account-desktop.svg";
import IconAccountMobile from "./images/app-account-mobile.svg";
import IconExploreDesktop from "./images/app-explore-desktop.svg";
import IconExploreMobile from "./images/app-explore-mobile.svg";
import IconWalletDesktop from "./images/app-wallet-desktop.svg";
import IconWalletMobile from "./images/app-wallet-mobile.svg";
import IconPsispaceDesktop from "./images/app-psispace-desktop.svg";
import IconPsispaceMobile from "./images/app-psispace-mobile.svg";

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
        title: "Accounts",
        description: "Create and manage accounts.",
        service: "account-sys",
        MobileIcon: IconAccountMobile,
        DesktopIcon: IconAccountDesktop,
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
    {
        title: "PsiSpace",
        description:
            "Upload files to your PsiSpace. Host static webpages! On the blockchain!",
        service: "psispace-sys",
        MobileIcon: IconPsispaceMobile,
        DesktopIcon: IconPsispaceDesktop,
        requiresUser: true,
    },
];

export default { appletPrefix, applets, AppletStates };
