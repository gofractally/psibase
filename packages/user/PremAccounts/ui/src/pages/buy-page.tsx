import type { PremAccountsOutletContext } from "@/components/prem-accounts-main";

import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";

import { siblingUrl } from "@psibase/common-lib";

import {
    PREM_ACCOUNTS_SERVICE,
    doesAccountExist,
    formatPrice,
} from "@/lib/prem-service";

import { supervisor } from "@shared/lib/supervisor";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

export function BuyPage() {
    const { bumpHistory } = useOutletContext<PremAccountsOutletContext>();
    const defaultMaxCost = "1.0000";
    const [accountName, setAccountName] = useState("");
    const [accountExists, setAccountExists] = useState<boolean | null>(null);
    const [price, setPrice] = useState<number | null>(null);
    const [systemToken, setSystemToken] = useState<{
        precision: number;
        symbol?: string;
        id?: number;
    } | null>(null);
    const [maxCost, setMaxCost] = useState(defaultMaxCost);
    const [prices, setPrices] = useState<number[]>([]);
    const [hasLoadedPrices, setHasLoadedPrices] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const [buySuccessMessage, setBuySuccessMessage] = useState("");

    const loadSystemToken = async () => {
        try {
            const sysTidRaw = (await supervisor.functionCall({
                service: "tokens",
                plugin: "plugin",
                intf: "helpers",
                method: "fetchNetworkToken",
                params: [],
            })) as number | bigint | null;

            if (!sysTidRaw) {
                return;
            }

            const sysTid =
                typeof sysTidRaw === "bigint" ? Number(sysTidRaw) : sysTidRaw;

            const tokensGraphqlUrl = siblingUrl(null, "tokens", "/graphql");

            const tokenResponse = await fetch(tokensGraphqlUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    query: `
                        query {
                            token(tokenId: "${sysTid}") {
                                precision
                                symbol
                            }
                        }
                    `,
                }),
            });
            const tokenData = (await tokenResponse.json()) as {
                data?: { token?: { precision?: number; symbol?: string } };
                errors?: Array<{ message: string }>;
            };
            if (tokenData.errors) {
                throw new Error(tokenData.errors[0].message);
            }

            const token = tokenData.data?.token;
            if (token && typeof token.precision === "number") {
                setSystemToken({
                    precision: token.precision,
                    symbol: token.symbol,
                    id: sysTid,
                });
            }
        } catch (e) {
            console.error("Failed to load system token:", e);
        }
    };

    const loadPrices = async () => {
        try {
            const pricesArray = (await supervisor.functionCall({
                service: PREM_ACCOUNTS_SERVICE,
                intf: "queries",
                method: "getPrices",
                params: [],
            })) as unknown;

            let pricesAsNumbers: number[];
            if (pricesArray instanceof BigUint64Array) {
                pricesAsNumbers = [];
                for (let i = 0; i < pricesArray.length; i++) {
                    pricesAsNumbers.push(Number(pricesArray[i]));
                }
            } else if (Array.isArray(pricesArray)) {
                pricesAsNumbers = pricesArray.map((p) => {
                    if (typeof p === "bigint") {
                        return Number(p);
                    }
                    if (typeof p === "string") {
                        return Number(p);
                    }
                    return p as number;
                });
            } else {
                console.error("Unexpected prices format:", pricesArray);
                pricesAsNumbers = [];
            }

            setPrices(pricesAsNumbers);
        } catch (e) {
            console.error("Failed to load prices:", e);
        } finally {
            setHasLoadedPrices(true);
        }
    };

    useEffect(() => {
        const init = async () => {
            await loadPrices();
            await loadSystemToken();
        };
        void init();
    }, []);

    useEffect(() => {
        const checkAccount = async () => {
            if (!accountName || accountName.length === 0) {
                setAccountExists(null);
                setPrice(null);
                return;
            }

            if (accountName.length < 1 || accountName.length > 9) {
                setAccountExists(null);
                setPrice(null);
                return;
            }

            const exists = await doesAccountExist(accountName);
            setAccountExists(exists);

            if (!exists && prices.length > 0) {
                const length = accountName.length;
                const priceIndex = length - 1;
                if (priceIndex >= 0 && priceIndex < prices.length) {
                    setPrice(prices[priceIndex]);
                } else {
                    setPrice(null);
                }
            } else {
                setPrice(null);
            }
        };

        const timeoutId = setTimeout(() => {
            void checkAccount();
        }, 500);
        return () => clearTimeout(timeoutId);
    }, [accountName, prices]);

    const handleBuy = async () => {
        if (!accountName || accountExists !== false || price === null) {
            return;
        }

        setIsLoading(true);
        setError("");
        setBuySuccessMessage("");

        const purchasedName = accountName;

        try {
            await supervisor.functionCall({
                service: PREM_ACCOUNTS_SERVICE,
                intf: "api",
                method: "buy",
                params: [accountName, maxCost],
            });

            setBuySuccessMessage(
                `Account '${purchasedName}' purchased successfully`,
            );
            setAccountName("");
            setAccountExists(null);
            setPrice(null);
            setMaxCost(defaultMaxCost);
            await loadPrices();
            bumpHistory();
            setTimeout(() => setBuySuccessMessage(""), 5000);
        } catch (e) {
            if (e instanceof Error) {
                setError(e.message);
            } else {
                setError("Failed to purchase account name");
            }
        } finally {
            setIsLoading(false);
        }
    };

    const maxCostLabel =
        systemToken?.symbol ??
        (systemToken?.id != null ? `token ${systemToken.id}` : "SysToken");
    const isBuyEnabled =
        accountName.length >= 1 &&
        accountName.length <= 9 &&
        accountExists === false &&
        price !== null &&
        maxCost.trim().length > 0 &&
        !isLoading;

    const priceIndex =
        accountName.length >= 1 && accountName.length <= 9
            ? accountName.length - 1
            : -1;
    const noMarketForNameLength =
        hasLoadedPrices &&
        accountExists === false &&
        priceIndex >= 0 &&
        (prices.length === 0 || priceIndex >= prices.length);

    return (
        <div className="mt-2">
            <h1 className="mb-6 text-2xl font-semibold">Buy a name</h1>
            <div className="grid grid-cols-6">
                <div className="col-span-6 grid grid-cols-6">
                    <Label htmlFor="accountName" className="col-span-2">
                        Desired account name
                    </Label>
                    <Input
                        id="accountName"
                        className="col-span-4"
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                            setAccountName(e.target.value);
                            setError("");
                            setBuySuccessMessage("");
                        }}
                        value={accountName}
                        placeholder="Enter 1-9 character name"
                    />
                </div>

                <div className="col-span-6 mt-4 grid grid-cols-6">
                    <Label htmlFor="maxCost" className="col-span-2">
                        Max cost ({maxCostLabel})
                    </Label>
                    <Input
                        id="maxCost"
                        className="col-span-4"
                        type="text"
                        value={maxCost}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                            setMaxCost(e.target.value);
                            setError("");
                            setBuySuccessMessage("");
                        }}
                        placeholder={defaultMaxCost}
                    />
                </div>
                <div className="col-span-6 mt-6 font-medium">
                    <Button
                        type="button"
                        disabled={!isBuyEnabled}
                        onClick={() => void handleBuy()}
                    >
                        {isLoading ? "Processing..." : "Buy"}
                    </Button>
                </div>

                <div className="col-span-6 mt-4 flex min-h-[3rem] items-center">
                    {error && <p className="text-red-500">{error}</p>}
                    {!error && buySuccessMessage && (
                        <p className="font-medium text-green-600">
                            {buySuccessMessage}
                        </p>
                    )}
                    {!error &&
                        !buySuccessMessage &&
                        accountName.length > 0 &&
                        accountName.length <= 9 && (
                            <div>
                                {accountExists === true && (
                                    <p className="text-red-500">
                                        Account name already exists
                                    </p>
                                )}
                                {accountExists === false && price !== null && (
                                    <p className="text-green-600">
                                        Buy for{" "}
                                        {formatPrice(
                                            price,
                                            systemToken?.precision,
                                            systemToken?.symbol,
                                        )}
                                    </p>
                                )}
                                {accountExists === false &&
                                    price === null &&
                                    !hasLoadedPrices && (
                                        <p className="text-gray-500">
                                            Loading price...
                                        </p>
                                    )}
                                {accountExists === false &&
                                    noMarketForNameLength && (
                                        <p className="text-muted-foreground">
                                            {accountName} is not a premium name.
                                        </p>
                                    )}
                            </div>
                        )}
                </div>
            </div>
        </div>
    );
}
