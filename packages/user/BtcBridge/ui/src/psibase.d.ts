declare module 'psibase-common' {
 export function getSupervisor(): { functionCall(args:{service:string;plugin?:string;intf:string;method:string;params:unknown[]},options?:{enabled:boolean;returnPath:string}):Promise<any> };
 export function isRedirectErrorObject(error:unknown):boolean;
 export function handlePluginUserPrompt(error:unknown,returnPath:string):void;
 export function siblingUrl(base:string|null|undefined,service:string,path?:string|null):string;
}
// The same library under the name shared-ui imports it by. Both resolve to /common/common-lib.js.
declare module '@psibase/common-lib' {
 export type AutoRedirectConfig={enabled:boolean;returnPath?:string};
 export function getSupervisor(): { functionCall(args:{service:string;plugin?:string;intf:string;method:string;params:unknown[]},options?:{enabled:boolean;returnPath:string}):Promise<any> };
 export function siblingUrl(base?:string|null,service?:string|null,path?:string|null,baseUrlIncludesSibling?:boolean):string;
}
