import type { ReactNode } from "react";

import { ExternalLink, Package } from "lucide-react";

import { siblingUrl } from "@psibase/common-lib";

import { KeyValue, Panel } from "@/components/page-header";

import { useExplorerInstalled } from "@/hooks/use-explorer-chain";
import {
    useInstalledPackagesWithOwners,
    useServiceCode,
    useSiteConfig,
} from "@/hooks/use-owned-on-network";

import { cn } from "@shared/lib/utils";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

/** Links into the Explorer when it's installed; plain text otherwise. */
const ExplorerLink = ({
    path,
    className,
    children,
}: {
    path: string;
    className?: string;
    children: ReactNode;
}) => {
    const explorerInstalled = useExplorerInstalled();
    if (!explorerInstalled) {
        return <span className={className}>{children}</span>;
    }
    return (
        <a
            href={siblingUrl(null, "explorer", path)}
            className={cn("text-primary hover:underline", className)}
        >
            {children}
        </a>
    );
};

const Muted = ({ children }: { children: ReactNode }) => (
    <span className="text-muted-foreground text-xs">{children}</span>
);

export const OwnedOnNetwork = ({ user }: { user: string }) => {
    const packages = useInstalledPackagesWithOwners();
    const code = useServiceCode(user);
    const site = useSiteConfig(user);

    const ownedPackages =
        packages.data?.filter((p) => p.owner === user) ?? [];
    const memberOfPackage = packages.data?.find(
        (p) =>
            p.meta.accounts.includes(user) || p.meta.services.includes(user),
    );
    const siteUrl = siblingUrl(null, user, "/");

    return (
        <Panel title="What you own on the network">
            <KeyValue label="Packages">
                {packages.isPending ? (
                    <Skeleton className="h-4 w-32" />
                ) : packages.isError ? (
                    <Muted>Couldn't load installed packages</Muted>
                ) : ownedPackages.length === 0 ? (
                    <Muted>You don't own any installed packages</Muted>
                ) : (
                    <ul className="flex flex-col gap-1">
                        {ownedPackages.map(({ meta }) => (
                            <li
                                key={meta.name}
                                className="flex flex-wrap items-center gap-2 text-xs"
                            >
                                <Package className="text-muted-foreground size-3.5" />
                                <ExplorerLink
                                    path={`/services?q=${encodeURIComponent(meta.name)}`}
                                >
                                    {meta.name}
                                </ExplorerLink>
                                <span className="text-muted-foreground font-mono">
                                    v{meta.version}
                                </span>
                                <span className="text-muted-foreground">
                                    {meta.services.length}{" "}
                                    {meta.services.length === 1
                                        ? "service"
                                        : "services"}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </KeyValue>
            {memberOfPackage && (
                <KeyValue label="Part of package">
                    <span className="flex flex-wrap items-center gap-2 text-xs">
                        <ExplorerLink
                            path={`/services?q=${encodeURIComponent(memberOfPackage.meta.name)}`}
                        >
                            {memberOfPackage.meta.name}
                        </ExplorerLink>
                        <span className="text-muted-foreground">owned by</span>
                        <ExplorerLink
                            path={`/accounts/${memberOfPackage.owner}`}
                            className="font-mono"
                        >
                            {memberOfPackage.owner}
                        </ExplorerLink>
                    </span>
                </KeyValue>
            )}
            <KeyValue label="Service code">
                {code.isPending ? (
                    <Skeleton className="h-4 w-40" />
                ) : code.isError ? (
                    <Muted>Couldn't load service code</Muted>
                ) : code.data ? (
                    <span className="font-mono text-xs">
                        {code.data.codeHash.slice(0, 16)}… · vm{" "}
                        {code.data.vmType}.{code.data.vmVersion}
                    </span>
                ) : (
                    <Muted>No WASM deployed on your account</Muted>
                )}
            </KeyValue>
            <KeyValue label="Website">
                {site.isPending ? (
                    <Skeleton className="h-4 w-40" />
                ) : site.isError ? (
                    <Muted>Couldn't load site</Muted>
                ) : site.data ? (
                    <a
                        href={siteUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary inline-flex items-center gap-1 font-mono text-xs hover:underline"
                    >
                        {new URL(siteUrl).host}
                        <ExternalLink className="size-3" />
                    </a>
                ) : (
                    <Muted>No site hosted on your account</Muted>
                )}
            </KeyValue>
        </Panel>
    );
};
