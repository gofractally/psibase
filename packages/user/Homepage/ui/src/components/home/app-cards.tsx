import type { LucideIcon } from "lucide-react";

import {
    ArrowUpRight,
    Blocks,
    Book,
    Hammer,
    Settings,
    Terminal,
} from "lucide-react";

import { siblingUrl } from "@psibase/common-lib";

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
            href={siblingUrl(null, app.service, null)}
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
        EXPLORER,
        DOCS,
        ...(signedIn ? SIGNED_IN_APPS : []),
        ...(signedIn && isProducer ? PRODUCER_APPS : []),
    ];

    return (
        <section className="flex flex-col gap-3">
            <h2 className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider">
                Apps
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {apps.map((app) => (
                    <InstalledAppCard key={app.service} app={app} />
                ))}
            </div>
        </section>
    );
};
