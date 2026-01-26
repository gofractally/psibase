import { useEffect, useState } from "react";

import { Button } from "@shared/shadcn/ui/button";
import { Label } from "@shared/shadcn/ui/label";
import { Input } from "@shared/shadcn/ui/input";

import { Nav } from "@/components/nav";

import { getSupervisor, siblingUrl } from "@psibase/common-lib";
const supervisor = getSupervisor();

const doesAccountExist = async (
    accountName: string,
): Promise<boolean> => {
    try {
        const res = await supervisor.functionCall({
            method: "getAccount",
            params: [accountName],
            service: "accounts",
            intf: "api",
        });
        return Boolean(res && typeof res === "object" && "accountNum" in res);
    } catch {
        return false;
    }
};

const formatPrice = (difficulty: number, precision?: number, symbol?: string): string => {
    if (precision !== undefined) {
        const divisor = Math.pow(10, precision);
        const price = (difficulty / divisor).toFixed(precision);
        return symbol ? `${price} ${symbol}` : price;
    }
    return difficulty.toString();
};

export const App = () => {
    const [accountName, setAccountName] = useState<string>("");
    const [accountExists, setAccountExists] = useState<boolean | null>(null);
    const [price, setPrice] = useState<number | null>(null);
    const [systemToken, setSystemToken] = useState<{ precision: number; symbol?: string } | null>(null);
    const [prices, setPrices] = useState<number[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string>("");
    const thisServiceName = "prem-accounts";

    useEffect(() => {
        const init = async () => {
            await supervisor.onLoaded();
            await loadPrices();
            await loadSystemToken();
        };
        
        init();
    }, []);

    const loadSystemToken = async () => {
        try {
            const tokensGraphqlUrl = siblingUrl(null, "tokens", "/graphql");
            
            // First, get the system token ID from config
            const configResponse = await fetch(tokensGraphqlUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    query: `
                        query {
                            config {
                                sysTid
                            }
                        }
                    `,
                }),
            });
            const configData = (await configResponse.json()) as {
                data?: { config?: { sysTid?: number } };
                errors?: Array<{ message: string }>;
            };
            if (configData.errors) {
                throw new Error(configData.errors[0].message);
            }
            const sysTid = configData.data?.config?.sysTid;
            if (!sysTid) {
                return;
            }

            // Then, get the token details
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
                });
            }
        } catch (e) {
            console.error("Failed to load system token:", e);
        }
    };

    const loadPrices = async () => {
        try {
            const pricesArray = (await supervisor.functionCall({
                service: thisServiceName,
                intf: "queries",
                method: "getPrices",
                params: [],
            })) as number[];
            setPrices(pricesArray);
        } catch (e) {
            console.error("Failed to load prices:", e);
        }
    };

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
                const priceIndex = length - 1; // array[0] = length-1 price
                if (priceIndex >= 0 && priceIndex < prices.length) {
                    setPrice(prices[priceIndex]);
                } else {
                    setPrice(null);
                }
            } else {
                setPrice(null);
            }
        };

        const timeoutId = setTimeout(checkAccount, 500);
        return () => clearTimeout(timeoutId);
    }, [accountName, prices]);

    const handleBuy = async () => {
        if (!accountName || accountExists !== false || price === null) {
            return;
        }

        setIsLoading(true);
        setError("");

        try {
            console.info("calling buy()");
            await supervisor.functionCall({
                service: thisServiceName,
                intf: "api",
                method: "buy",
                params: [accountName],
            });
            console.info("buy() returned");
            
            // Reset form and reload prices
            setAccountName("");
            setAccountExists(null);
            setPrice(null);
            await loadPrices();
            console.info("loadPrices() returned");
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

    const isBuyEnabled = accountName.length >= 1 && 
                        accountName.length <= 9 && 
                        accountExists === false && 
                        price !== null && 
                        !isLoading;

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <Nav title="Premium Account Names" />
            <div className="mx-auto grid max-w-screen-md grid-cols-6">
                <div className="col-span-6 mt-6 grid grid-cols-6">
                    <Label htmlFor="accountName" className="col-span-2">
                        Desired account name
                    </Label>
                    <Input
                        id="accountName"
                        className="col-span-4"
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                            setAccountName(e.target.value);
                            setError("");
                        }}
                        value={accountName}
                        placeholder="Enter 1-9 character name"
                    />
                </div>
                
                {accountName.length > 0 && accountName.length <= 9 && (
                    <div className="col-span-6 mt-4">
                        {accountExists === true && (
                            <p className="text-red-500">Account name already exists</p>
                        )}
                        {accountExists === false && price !== null && (
                            <p className="text-green-600">
                                Buy for {formatPrice(price, systemToken?.precision, systemToken?.symbol)}
                            </p>
                        )}
                        {accountExists === false && price === null && (
                            <p className="text-gray-500">Loading price...</p>
                        )}
                    </div>
                )}

                {error && (
                    <div className="col-span-6 mt-4">
                        <p className="text-red-500">{error}</p>
                    </div>
                )}

                <div className="col-span-6 mt-6 font-medium">
                    <Button
                        type="button"
                        disabled={!isBuyEnabled}
                        onClick={handleBuy}
                    >
                        {isLoading ? "Processing..." : "Buy"}
                    </Button>
                </div>
            </div>
        </div>
    );
};
