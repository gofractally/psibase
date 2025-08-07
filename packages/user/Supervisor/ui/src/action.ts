export interface Action {
    service: string;
    action: string;
    args: Uint8Array;
}
