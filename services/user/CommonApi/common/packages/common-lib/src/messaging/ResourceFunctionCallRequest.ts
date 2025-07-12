import { QualifiedFunctionCallArgs } from "./FunctionCallRequest";

export interface ResourceCallArgs {
    service: string;
    plugin?: string;
    intf?: string;
    type: string;
    handle?: number;
    method: string;
    params: any[];
}

export interface QualifiedResourceCallArgs extends ResourceCallArgs {
    plugin: string;
    intf: string;
}

export function toQualifiedFunctionCallArgs(args: QualifiedResourceCallArgs ): QualifiedFunctionCallArgs {
    return { 
        service: args.service, 
        plugin: args.plugin, 
        intf: args.intf, 
        method: args.type + "." + args.method, 
        params: args.params 
    };
}

export function getResourceCallArgs(
    service: string,
    plugin: string,
    intf: string,
    type: string,
    handle: number,
    method: string,
    params: any[],
): QualifiedResourceCallArgs {
    return { service, plugin, intf, type, handle, method, params };
}