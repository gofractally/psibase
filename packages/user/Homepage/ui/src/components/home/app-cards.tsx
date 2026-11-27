import type { LucideIcon } from "lucide-react";

import {
    ArrowLeftRight,
    ArrowUpRight,
    Bitcoin,
    Blocks,
    Book,
    CandlestickChart,
    Coins,
    Hammer,
    HandCoins,
    Mail,
    Settings,
    Store,
    Terminal,
    Users,
} from "lucide-react";

import { siblingUrl } from "@psibase/common-lib";

import { DashboardSection } from "@/components/home/dashboard-section";

import { useIsCurrentUserProducer } from "@/hooks/use-producers";

import { useIsPackageInstalled } from "@shared/hooks/use-is-package-installed";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

interface AppLink {
    service: string;
    name: string;
    description: string;
    icon: LucideIcon;
    color: string;
    /** Only shown once this package is confirmed installed on the chain. */
    packageName?: string;
    newTab?: boolean;
    producerOnly?: boolean;
    /** A page of this app rather than another app's site. */
    path?: string;
}

const EXPLORER: AppLink = {
    service: "explorer",
    name: "Explorer",
    description: "Browse blocks, transactions, and accounts in real time.",
    icon: Blocks,
    color: "hsl(212 85% 60%)",
    packageName: "Explorer",
};

const DOCS: AppLink = {
    service: "docs",
    name: "Docs",
    description: "Review technical documentation and guides.",
    icon: Book,
    color: "hsl(38 92% 55%)",
    packageName: "Docs",
};

// The parts of this app a signed-in account uses, listed with the apps so
// that they can be found from the landing page as well as from the top bar and
// the account menu.
const BUILT_IN: AppLink[] = [
    {
        service: "homepage",
        path: "/tokens",
        name: "Wallet",
        description: "Hold, send and receive tokens; accept or cancel pending transfers.",
        icon: Coins,
        color: "hsl(226 80% 66%)",
    },
    {
        service: "homepage",
        path: "/chainmail",
        name: "Mail",
        description: "Messages between accounts on this network.",
        icon: Mail,
        color: "hsl(190 80% 55%)",
    },
    {
        service: "homepage",
        path: "/contacts",
        name: "Contacts",
        description: "People you know here, their profiles, and invitations.",
        icon: Users,
        color: "hsl(142 60% 50%)",
    },
    {
        service: "homepage",
        path: "/tokens/swap",
        name: "Swap",
        description: "Trade one token for another through liquidity pools.",
        icon: ArrowLeftRight,
        color: "hsl(28 90% 58%)",
    },
    {
        service: "homepage",
        path: "/account-marketplace",
        name: "Name market",
        description: "Buy premium account names.",
        icon: Store,
        color: "hsl(320 70% 62%)",
        packageName: "NameMarket",
    },
];

// Apps with their own site, shown when their package is installed.
const INSTALLED_APPS: AppLink[] = [
    {
        service: "exchange",
        name: "Exchange",
        description: "Order books, lending and relays for any pair of tokens.",
        icon: CandlestickChart,
        color: "hsl(160 70% 48%)",
        packageName: "Exchange",
    },
    {
        service: "btcbridge",
        name: "Bitcoin bridge",
        description: "Deposit and withdraw bitcoin as a token on this network.",
        icon: Bitcoin,
        color: "hsl(33 95% 55%)",
        packageName: "BtcBridge",
    },
    {
        service: "favor",
        name: "Favor",
        description: "Credit between people you trust, settled by netting.",
        icon: HandCoins,
        color: "hsl(265 75% 68%)",
        packageName: "Favor",
    },
];

const SIGNED_IN_APPS: AppLink[] = [
    {
        service: "workshop",
        name: "Workshop",
        description: "Build, publish, and manage apps on the network.",
        icon: Hammer,
        color: "hsl(270 70% 65%)",
        packageName: "Workshop",
        newTab: true,
    },
];

const PRODUCER_APPS: AppLink[] = [
    {
        service: "config",
        name: "Config",
        description: "Manage network-wide settings and installed packages.",
        icon: Terminal,
        color: "hsl(158 64% 45%)",
        newTab: true,
        producerOnly: true,
    },
    {
        service: "x-admin",
        name: "X-Admin",
        description: "Administer this node: peers, logs, and services.",
        icon: Settings,
        color: "hsl(350 78% 60%)",
        newTab: true,
        producerOnly: true,
    },
];

const AppCard = ({ app }: { app: AppLink }) => {
    const Icon = app.icon;

    return (
        <a
            href={app.path ?? siblingUrl(null, app.service, null)}
            {...(app.newTab && {
                target: "_blank",
                rel: "noopener noreferrer",
            })}
            className="bg-card/70 hover:bg-accent/40 hover:border-foreground/20 group flex flex-col gap-3 rounded-xl border p-4 shadow-sm backdrop-blur transition-colors"
        >
            <div className="flex items-start justify-between">
                <span
                    className="flex size-9 items-center justify-center rounded-lg border"
                    style={{
                        color: app.color,
                        borderColor: `color-mix(in oklch, ${app.color} 40%, transparent)`,
                        backgroundColor: `color-mix(in oklch, ${app.color} 12%, transparent)`,
                    }}
                >
                    <Icon className="size-4" />
                </span>
                <ArrowUpRight className="text-muted-foreground group-hover:text-foreground size-4 transition-colors" />
            </div>
            <div>
                <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                    {app.name}
                    {app.producerOnly && (
                        <span className="text-muted-foreground rounded border px-1 text-[10px] font-normal">
                            producer
                        </span>
                    )}
                </h3>
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                    {app.description}
                </p>
            </div>
        </a>
    );
};

const AppCardSkeleton = () => (
    <div
        aria-busy
        className="bg-card/70 flex flex-col gap-3 rounded-xl border p-4 shadow-sm"
    >
        <Skeleton className="size-9 rounded-lg" />
        <div className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-3/4" />
        </div>
    </div>
);

const InstalledAppCard = ({ app }: { app: AppLink }) => {
    const { data: isInstalled, isPending } = useIsPackageInstalled(
        app.packageName ?? "",
        { enabled: !!app.packageName },
    );

    if (!app.packageName) return <AppCard app={app} />;
    if (isPending) return <AppCardSkeleton />;
    return isInstalled === true ? <AppCard app={app} /> : null;
};

export const AppCards = ({ signedIn }: { signedIn: boolean }) => {
    const isProducer = useIsCurrentUserProducer();

    const apps = [
        ...(signedIn ? BUILT_IN : []),
        ...(signedIn ? INSTALLED_APPS : []),
        EXPLORER,
        DOCS,
        ...(signedIn ? SIGNED_IN_APPS : []),
        ...(signedIn && isProducer ? PRODUCER_APPS : []),
    ];

    return (
        <DashboardSection title="Apps">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {apps.map((app) => (
                    <InstalledAppCard key={app.path ?? app.service} app={app} />
                ))}
            </div>
        </DashboardSection>
    );
};

export const AppCardsSkeleton = () => (
    <DashboardSection title="Apps">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
                <AppCardSkeleton key={i} />
            ))}
        </div>
    </DashboardSection>
);
