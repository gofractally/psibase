import { siblingUrl } from "@psibase/common-lib";

import { Billing } from "@/components/billing";
import { VirtualServer } from "@/components/virtual-server";
import { useQuery } from "@tanstack/react-query";

import { graphql } from "@/lib/graphql";


interface SystemTokenInfo {
    id: string;
    symbol?: string;
}

interface ConfigResponse {
    config: {
        sysTid: number | null;
    } | null;
}

interface TokenResponse {
    token: {
        id: string;
        symbol?: {
            symbolId: string;
        } | null;
    } | null;
}

const useSystemToken = () => {
    return useQuery<SystemTokenInfo | null>({
        queryKey: ["systemToken"],
        queryFn: async () => {
            try {
                // First, get the system token ID from config
                const configQuery = `
                    query {
                        config {
                            sysTid
                        }
                    }
                `;

                const configRes = await graphql<ConfigResponse>(
                    configQuery,
                    siblingUrl(null, "tokens", "/graphql"),
                );

                if (!configRes.config?.sysTid) {
                    return null;
                }

                const sysTid = configRes.config.sysTid;
                console.info("sysTid", sysTid);
                // Then, get the token details
                const tokenQuery = `
                    query {
                        token(tokenId: "${sysTid}") {
                            id
                            symbol
                        }
                    }
                `;

                const tokenRes = await graphql<TokenResponse>(
                    tokenQuery,
                    siblingUrl(null, "tokens", "/graphql"),
                );
                console.info("tokenRes", tokenRes);

                if (!tokenRes.token) {
                    return null;
                }

                return {
                    id: tokenRes.token.id.toString(),
                    symbol: tokenRes.token.symbol?.symbolId,
                };
            } catch (error) {
                console.error("Error fetching system token:", error);
                return null;
            }
        },
    });
};

export const Resources = () => {
    const { data: systemToken, isLoading: systemTokenLoading } = useSystemToken();
    console.info("systemToken", systemToken);

    return (
        <div className="mx-auto w-full max-w-screen-lg space-y-6 px-2">
            <div>
                <h2 className="text-lg font-medium">Resources</h2>
                <p className="text-muted-foreground text-sm">
                    Configure virtual server resources and billing settings.
                </p>
            </div>

            <div className="space-y-6">
                <VirtualServer />
                <Billing
                    systemToken={systemToken ?? null}
                    systemTokenLoading={systemTokenLoading}
                />
            </div>
        </div>
    );
};

