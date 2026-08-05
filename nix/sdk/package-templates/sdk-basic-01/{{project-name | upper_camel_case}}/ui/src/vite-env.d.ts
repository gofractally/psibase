/// <reference types="vite/client" />

declare module "@psibase/common-lib" {
  export function getSupervisor(): {
    onLoaded(): Promise<void>;
    functionCall(args: {
      service: string;
      intf: string;
      method: string;
      params: unknown[];
    }): Promise<unknown>;
  };
}
