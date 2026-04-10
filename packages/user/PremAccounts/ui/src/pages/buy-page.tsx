import type { PremAccountsOutletContext } from "@/components/prem-accounts-main";

import { useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";

import { siblingUrl } from "@psibase/common-lib";

import { PREM_ACCOUNTS_SERVICE, doesAccountExist } from "@/lib/prem-service";

import {
    canonicalTokenAmountToRaw,
    expandToCanonicalTokenDecimal,
    formatCanonicalTokenAmount,
    unitTokenAmountCanonical,
} from "@shared/lib/quantity";
import {
    MAX_PREMIUM_NAME_LENGTH,
    MIN_PREMIUM_NAME_LENGTH,
    zAccount,
} from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

export function BuyPage() {
    const { bumpHistory } = useOutletContext<PremAccountsOutletContext>();
    const maxCostDefaultSynced = useRef(false);
    const [accountName, setAccountName] = useState("");
    const [accountExists, setAccountExists] = useState<boolean | null>(null);
    const [price, setPrice] = useState<string | null>(null);
    const [systemToken, setSystemToken] = useState<{
        precision: number;
        symbol?: string;
        id?: number;
    } | null>(null);
    const [maxCost, setMaxCost] = useState("1.0000");
    const [priceByLength, setPriceByLength] = useState<Map<number, string>>(
        () => new Map(),
    );
    const [hasLoadedPrices, setHasLoadedPrices] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const [buySuccessMessage, setBuySuccessMessage] = useState("");

    const trimmedAccount = accountName.trim();
    const nameZodResult =
        trimmedAccount.length > 0 ? zAccount.safeParse(trimmedAccount) : null;
    const nameValidationMessage =
        nameZodResult && !nameZodResult.success
            ? (nameZodResult.error.issues[0]?.message ?? "Invalid account name")
            : "";
    const accountNameValid = nameZodResult?.success === true;

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
                if (!maxCostDefaultSynced.current) {
                    setMaxCost(unitTokenAmountCanonical(token.precision));
                    maxCostDefaultSynced.current = true;
                }
            }
        } catch (e) {
            console.error("Failed to load system token:", e);
        }
    };

    const loadPrices = async () => {
        try {
            const query = "query { currentPrices { length price } }";
            const raw = await supervisor.functionCall({
                service: PREM_ACCOUNTS_SERVICE,
                plugin: "plugin",
                intf: "authorized",
                method: "graphql",
                params: [query],
            });
            const text = typeof raw === "string" ? raw : JSON.stringify(raw);
            const body = JSON.parse(text) as {
                data?: {
                    currentPrices?: Array<{ length: number; price: string }>;
                };
                errors?: Array<{ message: string }>;
            };
            if (body.errors?.length) {
                throw new Error(body.errors[0].message);
            }
            const rows = body.data?.currentPrices;

            const next = new Map<number, string>();
            if (Array.isArray(rows)) {
                for (const row of rows) {
                    if (row && typeof row === "object") {
                        const len = Number(row.length);
                        const priceStr =
                            typeof row.price === "string"
                                ? row.price.trim()
                                : row.price != null
                                  ? String(row.price).trim()
                                  : "";
                        if (
                            Number.isFinite(len) &&
                            len >= MIN_PREMIUM_NAME_LENGTH &&
                            len <= MAX_PREMIUM_NAME_LENGTH &&
                            priceStr.length > 0
                        ) {
                            next.set(len, priceStr);
                        }
                    }
                }
            } else {
                console.error("Unexpected prices format:", body);
            }

            setPriceByLength(next);
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
            const trimmed = accountName.trim();
            if (!trimmed) {
                setAccountExists(null);
                setPrice(null);
                return;
            }

            const zod = zAccount.safeParse(trimmed);
            if (!zod.success) {
                setAccountExists(null);
                setPrice(null);
                return;
            }

            const exists = await doesAccountExist(trimmed);
            setAccountExists(exists);

            if (!exists && priceByLength.size > 0) {
                const length = trimmed.length;
                const p = priceByLength.get(length);
                setPrice(p !== undefined ? p : null);
            } else {
                setPrice(null);
            }
        };

        const timeoutId = setTimeout(() => {
            void checkAccount();
        }, 500);
        return () => clearTimeout(timeoutId);
    }, [accountName, priceByLength]);

    const handleBuy = async () => {
        const trimmed = accountName.trim();
        const zod = zAccount.safeParse(trimmed);
        if (!zod.success) {
            setError(zod.error.issues[0]?.message ?? "Invalid account name");
            return;
        }

        if (accountExists !== false || price === null) {
            return;
        }

        const token = systemToken;
        if (token == null) {
            setError(
                "System token is not loaded yet. Please wait and try again.",
            );
            return;
        }

        setIsLoading(true);
        setError("");
        setBuySuccessMessage("");

        const purchasedName = trimmed;

        const maxCostForTx =
            expandToCanonicalTokenDecimal(maxCost, token.precision) ??
            maxCost.trim();
        const maxRaw = canonicalTokenAmountToRaw(maxCostForTx, token.precision);
        const priceRaw =
            price != null
                ? canonicalTokenAmountToRaw(price, token.precision)
                : null;
        if (maxRaw != null && priceRaw != null && maxRaw < priceRaw) {
            setError(
                "Max cost is below the current price. Raise max cost to at least the displayed price.",
            );
            setIsLoading(false);
            return;
        }

        try {
            await supervisor.functionCall({
                service: PREM_ACCOUNTS_SERVICE,
                intf: "api",
                method: "buy",
                params: [trimmed, maxCostForTx],
            });

            setBuySuccessMessage(
                `Account '${purchasedName}' purchased successfully`,
            );
            setAccountName("");
            setAccountExists(null);
            setPrice(null);
            setMaxCost(
                systemToken != null
                    ? unitTokenAmountCanonical(systemToken.precision)
                    : "1.0000",
            );
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
    const maxCostCanonical =
        systemToken != null
            ? expandToCanonicalTokenDecimal(maxCost, systemToken.precision)
            : null;
    const isBuyEnabled =
        systemToken != null &&
        maxCostCanonical != null &&
        accountNameValid &&
        accountExists === false &&
        price !== null &&
        !isLoading;

    const nameLen = accountNameValid ? trimmedAccount.length : 0;
    const noMarketForNameLength =
        hasLoadedPrices &&
        accountExists === false &&
        nameLen > 0 &&
        !priceByLength.has(nameLen);

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
                        placeholder={`e.g. my-name (letters, numbers, hyphens; ${MIN_PREMIUM_NAME_LENGTH}–${MAX_PREMIUM_NAME_LENGTH} chars)`}
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
                        placeholder={
                            systemToken != null
                                ? unitTokenAmountCanonical(
                                      systemToken.precision,
                                  )
                                : "1.0000"
                        }
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
                    {!error && nameValidationMessage && (
                        <p className="text-red-500">{nameValidationMessage}</p>
                    )}
                    {!error && !nameValidationMessage && buySuccessMessage && (
                        <p className="font-medium text-green-600">
                            {buySuccessMessage}
                        </p>
                    )}
                    {!error &&
                        !nameValidationMessage &&
                        !buySuccessMessage &&
                        trimmedAccount.length > 0 &&
                        accountNameValid && (
                            <div>
                                {accountExists === true && (
                                    <p className="text-red-500">
                                        Account name already exists
                                    </p>
                                )}
                                {accountExists === false && price !== null && (
                                    <p className="text-green-600">
                                        Buy for{" "}
                                        {formatCanonicalTokenAmount(
                                            price,
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
                                            {trimmedAccount} is not a premium
                                            name.
                                        </p>
                                    )}
                            </div>
                        )}
                </div>
            </div>
        </div>
    );
}
