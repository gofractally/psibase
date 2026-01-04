import { usePluginFunctionMutation } from "@shared/hooks/plugin-function/use-plugin-function-mutation";

import { Plugin as TokenSwap } from "./token-swap";
import { Plugin as Tokens } from "./tokens";

const tokenSwap = new TokenSwap("token-swap");
const tokens = new Tokens("tokens");

export {
    tokenSwap,
    tokens,
    usePluginFunctionMutation as usePluginFunctionCallMutation,
};
