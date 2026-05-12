import { usePluginFunctionMutation } from "@shared/hooks/plugin-function/use-plugin-function-mutation";
import { usePluginFunctionQuery } from "@shared/hooks/plugin-function/use-plugin-function-query";

import { Plugin as Profiles } from "./profiles";
import { Plugin as TokenSwap } from "./token-swap";
import { Plugin as Tokens } from "./tokens";

const tokenSwap = new TokenSwap("token-swap");
const tokens = new Tokens("tokens");
const profiles = new Profiles("profiles");

export {
    tokenSwap,
    tokens,
    profiles,
    usePluginFunctionMutation,
    usePluginFunctionQuery,
};
