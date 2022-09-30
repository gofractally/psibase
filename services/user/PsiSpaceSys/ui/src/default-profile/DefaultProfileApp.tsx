import { useEffect, useMemo, useState } from "react";
import { siblingUrl, getJson } from "common/rpc.mjs";

import { wait } from "../helpers";
import useEffectOnce from "../hooks/useEffectOnce";
import { Heading } from "../components";
import { capitalizeFirstLetter } from "../helpers";

export interface TokenBalance {
    account: string;
    balance: string;
    precision: number;
    token: number;
    symbol: string;
}

const fetchTokens = async (account: string) => {
    const url = await siblingUrl(null, "token-sys", `api/balances/${account}`);
    return getJson<TokenBalance[]>(url);
};

export const parseAmount = (
    balance: string | number,
    precision: number,
    fixed = false
) => {
    const parsed = Number(Number(balance) / Math.pow(10, precision));
    if (fixed) return parsed.toFixed(precision);
    return parsed.toString();
};

export const getParsedBalanceFromToken = (token?: TokenBalance) => {
    if (!token) return null;
    return parseAmount(token.balance, token.precision);
};

function DefaultProfileApp() {
    const [account, setAccount] = useState(""); // TODO: get account from domain/param
    const [accountTokens, setAccountTokens] = useState<TokenBalance[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffectOnce(() => {
        const queryParams = new URLSearchParams(window.location.search);
        const accountParam = queryParams.get("account");

        if (accountParam) {
            setAccount(accountParam);
        } else {
            const subdomain = window.location.host.split(".")[0];
            if (subdomain) {
                setAccount(subdomain);
            }
        }
    }, []);

    useEffect(() => {
        if (account) {
            setIsLoading(true);
            wait(1).then(async () => {
                try {
                    const tokens = await fetchTokens(account);
                    setAccountTokens(tokens);
                } catch (e) {
                    console.error("Fail to load account tokens", e);
                }
                setIsLoading(false);
            });
        }
    }, [account]);

    const profileTitle = useMemo(
        () => capitalizeFirstLetter(account),
        [account]
    );

    return (
        <div className="p-8 text-center">
            {accountTokens.length > 0 ? (
                <>
                    <Heading tag="h2" className="my-10">
                        {profileTitle}'s PsiSpace Profile
                    </Heading>
                    <Heading tag="h3">Account Tokens</Heading>
                    {accountTokens.map((token) => (
                        <div className="font-semibold" key={token.symbol}>
                            {getParsedBalanceFromToken(token)}{" "}
                            {(token.symbol || "?").toUpperCase()}
                        </div>
                    ))}
                    <p className="mt-16">(No Personalized content uploaded.)</p>
                </>
            ) : isLoading ? (
                <>Loading...</>
            ) : (
                <Heading tag="h2" className="my-10">
                    Oooops... Account not found...
                </Heading>
            )}
        </div>
    );
}

export default DefaultProfileApp;
