import { usePluginFunctionMutation } from "@shared/hooks/plugin-function/use-plugin-function-mutation";
import { usePluginFunctionQuery } from "@shared/hooks/plugin-function/use-plugin-function-query";

import { Plugin as Accounts } from "./accounts";
import { Plugin as Config } from "./config";
import { Plugin as Homepage } from "./homepage";
import { callPluginFunction } from "./lib/call-plugin-function";
import { Plugin as NameMarket } from "./namemarket";
import { Plugin as Packages } from "./packages";
import { Plugin as Profiles } from "./profiles";
import { Plugin as TokenSwap } from "./token-swap";
import { Plugin as Tokens } from "./tokens";
import { Plugin as VirtualServer } from "./vserver";

const accounts = new Accounts("accounts");
const config = new Config("config");
const homepage = new Homepage("homepage");
const packages = new Packages("packages");
const nameMarket = new NameMarket("namemarket");
const tokenSwap = new TokenSwap("token-swap");
const tokens = new Tokens("tokens");
const profiles = new Profiles("profiles");
const vserver = new VirtualServer("vserver");

export {
    accounts,
    config,
    homepage,
    packages,
    nameMarket,
    tokenSwap,
    tokens,
    profiles,
    vserver,
    callPluginFunction,
    usePluginFunctionMutation,
    usePluginFunctionQuery,
};
