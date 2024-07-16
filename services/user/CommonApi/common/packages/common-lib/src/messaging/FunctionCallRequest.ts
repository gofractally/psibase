import { FUNCTION_CALL_REQUEST } from "./index";

export interface FunctionCallArgs {
    service: string;
    plugin?: string;
    intf?: string;
    method: string;
    params: any[];
}

export interface QualifiedFunctionCallArgs extends FunctionCallArgs {
    plugin: string;
}

export const isQualifiedFunctionCallArgs = (
    obj: any,
): obj is QualifiedFunctionCallArgs => {
    return (
        typeof obj === "object" &&
        obj !== null &&
        typeof obj.service === "string" &&
        typeof obj.plugin === "string" &&
        (typeof obj.intf === "string" || obj.intf === undefined) &&
        typeof obj.method === "string" &&
        Array.isArray(obj.params)
    );
};

export function toString(item: QualifiedFunctionCallArgs): string;
export function toString(item: FunctionCallArgs): string;
export function toString(item: FunctionCallArgs): string {
    let { service, plugin, intf, method } = item;
    plugin = plugin || "plugin";
    intf = intf ? `/${intf}` : "";
    return `${service}:${plugin}${intf}->${method}`;
}

export interface FunctionCallRequest {
    type: typeof FUNCTION_CALL_REQUEST;
    args: QualifiedFunctionCallArgs;
}

export const isFunctionCallRequest = (data: any): data is FunctionCallRequest =>
    data && data.type == FUNCTION_CALL_REQUEST;
