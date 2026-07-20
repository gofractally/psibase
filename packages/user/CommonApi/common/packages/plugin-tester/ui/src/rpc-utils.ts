import { FunctionCallArgs } from "@psibase/common-lib";

export function withArgs(
    service: string,
    plugin: string,
    intf: string,
    method: string,
    params: unknown[] = [],
): FunctionCallArgs {
    return {
        service,
        plugin,
        intf,
        method,
        params,
    };
}
