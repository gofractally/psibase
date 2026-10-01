import { useEffect, useState } from "react";

import { siblingUrl } from "@psibase/common-lib";

import { useIsPrivateNetwork } from "@shared/hooks/use-is-private-network";

import {
    type ResourceProvider,
    useResourceProviders,
} from "../hooks/use-resource-providers";

function rootHost(urlOrHref: string): string {
    try {
        const parts = new URL(urlOrHref).hostname.split(".");
        if (parts.length <= 2) {
            return parts.join(".");
        }
        return parts.slice(1).join(".");
    } catch {
        return "";
    }
}

function shuffleInPlace<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
}

function purchaseUrl(provider: ResourceProvider): string {
    try {
        return siblingUrl(provider.endpoint, provider.app);
    } catch {
        return provider.endpoint;
    }
}

export const ResourceProvidersSection = () => {
    const { data: providers, isLoading } = useResourceProviders();
    const { isPrivateNetwork } = useIsPrivateNetwork();
    const [ordered, setOrdered] = useState<ResourceProvider[]>([]);

    useEffect(() => {
        if (!providers?.length) {
            setOrdered([]);
            return;
        }

        const current = rootHost(window.location.href);
        const pinned = providers.filter(
            (provider) => rootHost(provider.endpoint) === current,
        );
        const rest = shuffleInPlace(
            providers.filter(
                (provider) => rootHost(provider.endpoint) !== current,
            ),
        );
        setOrdered([...pinned, ...rest]);
    }, [providers]);

    if (!isPrivateNetwork && (isLoading || ordered.length === 0)) {
        return null;
    }

    return (
        <div id="resource-providers" className="space-y-4 border-t pt-8">
            <div>
                <h2 className="mb-2 text-2xl font-bold">Resource providers</h2>
                <p className="text-muted-foreground text-sm">
                    Purchase resources from a network infrastructure provider.
                </p>
            </div>

            {isLoading ? null : ordered.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                    No resource providers are registered on this network.
                </p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead>
                            <tr className="border-b">
                                <th className="py-2 pr-4 font-medium">
                                    Provider
                                </th>
                                <th className="py-2 pr-4 font-medium">
                                    Currencies
                                </th>
                                <th className="py-2 font-medium">Purchase</th>
                            </tr>
                        </thead>
                        <tbody>
                            {ordered.map((provider) => (
                                <tr
                                    key={provider.producer}
                                    className="border-b last:border-0"
                                >
                                    <td className="py-2 pr-4">
                                        {provider.producer}
                                    </td>
                                    <td className="py-2 pr-4">
                                        {provider.accepted.join(", ")}
                                    </td>
                                    <td className="py-2">
                                        <a
                                            className="text-primary underline underline-offset-2"
                                            href={purchaseUrl(provider)}
                                            target="_blank"
                                            rel="noreferrer"
                                        >
                                            Buy resources
                                        </a>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};
