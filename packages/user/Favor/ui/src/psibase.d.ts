// Runtime is supplied by the chain's /common/common-lib.js, as in the other
// psibase UIs. Keep this small type surface independent of build-time SDK internals.
export interface Supervisor {
    functionCall(args: {
        service: string;
        intf: string;
        method: string;
        params: unknown[];
        plugin?: string;
    }): Promise<any>;
}
export function getSupervisor(): Supervisor;
