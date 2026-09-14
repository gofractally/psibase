import { usePluginFunctionMutation } from "@shared/hooks/plugin-function/use-plugin-function-mutation";
import { usePluginFunctionQuery } from "@shared/hooks/plugin-function/use-plugin-function-query";

import { Plugin as Accounts } from "./accounts";
import { AuthorizedGraphqlPlugin } from "./authorized-graphql-plugin";
import { Plugin as Config } from "./config";
import { Plugin as Homepage } from "./homepage";
import { callPluginFunction } from "./lib/call-plugin-function";
import { Plugin as NameMarket } from "./namemarket";
import { Plugin as Packages } from "./packages";
import { Plugin as Profiles } from "./profiles";
import { Plugin as TokenSwap } from "./token-swap";
import { Plugin as Tokens } from "./tokens";

const accounts = new Accounts("accounts");
const config = new Config("config");
const homepage = new Homepage("homepage");
const packages = new Packages("packages");
const nameMarket = new NameMarket("namemarket");
const tokenSwap = new TokenSwap("token-swap");
const tokens = new Tokens("tokens");
const profiles = new Profiles("profiles");

const invite = new AuthorizedGraphqlPlugin("invite");
const producers = new AuthorizedGraphqlPlugin("producers");
const guilds = new AuthorizedGraphqlPlugin("guilds");
const fractals = new AuthorizedGraphqlPlugin("fractals");
const evaluation = new AuthorizedGraphqlPlugin("evaluation");
const stagedTx = new AuthorizedGraphqlPlugin("staged-tx");
const sites = new AuthorizedGraphqlPlugin("sites");
const registry = new AuthorizedGraphqlPlugin("registry");
const setcode = new AuthorizedGraphqlPlugin("setcode");
const transact = new AuthorizedGraphqlPlugin("transact");
const vserver = new AuthorizedGraphqlPlugin("vserver");

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
    invite,
    producers,
    guilds,
    fractals,
    evaluation,
    stagedTx,
    sites,
    registry,
    setcode,
    transact,
    callPluginFunction,
    usePluginFunctionMutation,
    usePluginFunctionQuery,
};
