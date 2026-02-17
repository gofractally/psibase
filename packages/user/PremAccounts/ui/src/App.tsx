import { useEffect, useState } from "react";

import { Button } from "@shared/shadcn/ui/button";
import { Label } from "@shared/shadcn/ui/label";
import { Input } from "@shared/shadcn/ui/input";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@shared/shadcn/ui/tabs";

import { Nav } from "@/components/nav";
import { useLoggedInUser } from "@/hooks";

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

const formatPrice = (difficulty: number | bigint, precision?: number, symbol?: string): string => {
    // Convert BigInt to number if needed
    const difficultyNum = typeof difficulty === 'bigint' ? Number(difficulty) : difficulty;
    
    if (precision !== undefined) {
        const divisor = Math.pow(10, precision);
        const price = (difficultyNum / divisor).toFixed(precision);
        return symbol ? `${price} ${symbol}` : price;
    }
    return difficultyNum.toString();
};

export const App = () => {
    const defaultMaxCost = "1.0000";
    const [accountName, setAccountName] = useState<string>("");
    const [accountExists, setAccountExists] = useState<boolean | null>(null);
    const [price, setPrice] = useState<number | null>(null);
    const [systemToken, setSystemToken] = useState<{ precision: number; symbol?: string; id?: number } | null>(null);
    const [maxCost, setMaxCost] = useState<string>(defaultMaxCost);
    const [prices, setPrices] = useState<number[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string>("");
    const [boughtNames, setBoughtNames] = useState<string[]>([]);
    const [isLoadingNames, setIsLoadingNames] = useState<boolean>(false);
    const [claimingNames, setClaimingNames] = useState<Set<string>>(new Set());
    const [buySuccessMessage, setBuySuccessMessage] = useState<string>("");
    const [claimSuccessMessage, setClaimSuccessMessage] = useState<string>("");
    const [claimSuccessNotification, setClaimSuccessNotification] = useState<{
        accountName: string;
        privateKey: string;
    } | null>(null);
    const { data: loggedInUser } = useLoggedInUser();
    const thisServiceName = "prem-accounts";

    useEffect(() => {
        const init = async () => {
            await supervisor.onLoaded();
            await loadPrices();
            await loadSystemToken();
        };
        
        init();
    }, []);

    const loadBoughtNames = async () => {
        if (!loggedInUser) return;
        
        setIsLoadingNames(true);
        try {
            const premAccountsGraphqlUrl = siblingUrl(null, thisServiceName, "/graphql");
            const response = await fetch(premAccountsGraphqlUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    query: `
                        query {
                            getBoughtNames(user: "${loggedInUser}")
                        }
                    `,
                }),
            });
            const data = (await response.json()) as {
                data?: { getBoughtNames?: string[] };
                errors?: Array<{ message: string }>;
            };
            if (data.errors) {
                throw new Error(data.errors[0].message);
            }
            setBoughtNames(data.data?.getBoughtNames || []);
        } catch (e) {
            console.error("Failed to load bought names:", e);
            setBoughtNames([]);
        } finally {
            setIsLoadingNames(false);
        }
    };

    useEffect(() => {
        if (loggedInUser) {
            loadBoughtNames();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loggedInUser]);

    const loadSystemToken = async () => {
        try {
            // First, get the system token ID via the tokens plugin helper
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

            // Then, get the token details from the tokens GraphQL query service
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
                service: thisServiceName,
                intf: "queries",
                method: "getPrices",
                params: [],
            })) as unknown;
            
            // The result comes back as a BigUint64Array (typed array) from WASM
            // Convert it to a regular array of numbers
            let pricesAsNumbers: number[];
            if (pricesArray instanceof BigUint64Array) {
                // Convert BigUint64Array to regular array of numbers
                // Use a for loop to explicitly convert each BigInt to number
                pricesAsNumbers = [];
                for (let i = 0; i < pricesArray.length; i++) {
                    pricesAsNumbers.push(Number(pricesArray[i]));
                }
            } else if (Array.isArray(pricesArray)) {
                // Fallback: if it's a regular array, convert any BigInt values to numbers
                pricesAsNumbers = pricesArray.map(price => {
                    if (typeof price === 'bigint') {
                        return Number(price);
                    } else if (typeof price === 'string') {
                        return Number(price);
                    } else {
                        return price as number;
                    }
                });
            } else {
                console.error("Unexpected prices format:", pricesArray);
                pricesAsNumbers = [];
            }
            
            setPrices(pricesAsNumbers);
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
        setBuySuccessMessage("");

        try {
            await supervisor.functionCall({
                service: thisServiceName,
                intf: "api",
                method: "buy",
                // TODO: replace max-cost
                                params: [accountName, maxCost],
            });
            
            // Show success message
            setBuySuccessMessage(`Account '${accountName}' purchased successfully`);
            
            // Reset form and reload prices and bought names
            setAccountName("");
            setAccountExists(null);
            setPrice(null);
            setMaxCost(defaultMaxCost);
            await loadPrices();
            await loadBoughtNames();
            
            // Clear success message after 5 seconds
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

    const maxCostLabel = systemToken?.symbol ?? (systemToken?.id != null ? `token ${systemToken.id}` : "SysToken");
    const isBuyEnabled = accountName.length >= 1 && 
                        accountName.length <= 9 && 
                        accountExists === false && 
                        price !== null && 
                        maxCost.trim().length > 0 &&
                        !isLoading;

    const handleClaim = async (accountName: string) => {
        if (claimingNames.has(accountName)) {
            return; // Already claiming
        }

        setClaimingNames((prev) => new Set(prev).add(accountName));
        setError("");
        setClaimSuccessMessage("");
        setClaimSuccessNotification(null);

        try {
            const privateKey = (await supervisor.functionCall({
                service: thisServiceName,
                plugin: "plugin",
                intf: "api",
                method: "claim",
                params: [accountName],
            })) as string;
            console.log("privateKey", privateKey);

            setClaimSuccessMessage(`Account '${accountName}' claimed successfully`);
            setClaimSuccessNotification({ accountName, privateKey });

            await loadBoughtNames();

            setTimeout(() => setClaimSuccessMessage(""), 5000);
        } catch (e) {
            if (e instanceof Error) {
                setError(e.message);
            } else {
                setError(`Failed to claim account ${accountName}`);
            }
        } finally {
            setClaimingNames((prev) => {
                const next = new Set(prev);
                next.delete(accountName);
                return next;
            });
        }
    };

    return (
        <div className="mx-auto h-screen w-screen max-w-screen-lg">
            <Nav title="Premium Account Names" />
            <div className="mx-auto max-w-screen-md">
                <Tabs defaultValue="buy" className="w-full">
                    <TabsList className="mt-6">
                        <TabsTrigger value="buy">Buy</TabsTrigger>
                        <TabsTrigger value="purchased-names">Purchased Names</TabsTrigger>
                    </TabsList>
                    
                    {(buySuccessMessage || claimSuccessMessage) && (
                        <div className="mt-4">
                            {buySuccessMessage && (
                                <p className="text-green-600 font-medium">{buySuccessMessage}</p>
                            )}
                            {claimSuccessMessage && (
                                <p className="text-green-600 font-medium">{claimSuccessMessage}</p>
                            )}
                        </div>
                    )}
                    
                    <TabsContent value="buy" className="mt-6">
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

                            <div className="col-span-6 grid grid-cols-6 mt-4">
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
                    </TabsContent>
                    
                    <TabsContent value="purchased-names" className="mt-6">
                        <div>
                            {isLoadingNames ? (
                                <p className="text-gray-500">Loading your purchased names...</p>
                            ) : boughtNames.length === 0 ? (
                                <p className="text-gray-500">You haven't purchased any account names yet.</p>
                            ) : (
                                <ul className="space-y-2">
                                    {boughtNames.map((name) => (
                                        <li key={name} className="flex items-center justify-between border-b pb-2">
                                            <span className="text-base font-mono">{name}</span>
                                            <Button
                                                type="button"
                                                size="sm"
                                                disabled={claimingNames.has(name)}
                                                onClick={() => handleClaim(name)}
                                            >
                                                {claimingNames.has(name) ? "Claiming..." : "Claim"}
                                            </Button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {claimSuccessNotification && (
                                <div className="mt-4 rounded-lg border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/50 p-4">
                                    <p className="text-green-700 dark:text-green-300 font-medium mb-2">
                                        Account &apos;{claimSuccessNotification.accountName}&apos; claimed successfully
                                    </p>
                                    <p className="text-sm text-muted-foreground mb-1">Private key (save this securely):</p>
                                    <p className="font-mono text-sm break-all bg-muted/80 rounded p-2 mb-4">
                                        {claimSuccessNotification.privateKey}
                                    </p>
                                    <Button
                                        type="button"
                                        size="sm"
                                        onClick={() => setClaimSuccessNotification(null)}
                                    >
                                        Ok
                                    </Button>
                                </div>
                            )}
                        </div>
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    );
};
