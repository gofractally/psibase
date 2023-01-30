import { action, AppletId, getJson,  operation, query,  } from "common/rpc.mjs";

const OPERATIONS_KEY = 'OPERATIONS_KEY'
const QUERIES_KEY = 'QUERIES_KEY'

/**
 * Description: Class to blueprint the applets contract + operations.
 */
 export class Service {
    cachedApplet = '';

    constructor() {
        this.applet();
    }

    async applet() {
        if (this.cachedApplet) return this.cachedApplet;
        const appletName = await getJson("/common/thisservice");
        console.log(appletName, 'is the applet name')
        this.cachedApplet = appletName;
        return appletName;
    }

    async getAppletName() {
        return this.applet();
    }
    
    async getAppletId() {
        const appletName = await this.getAppletName();
        return new AppletId(appletName);
    }

    get operations() {
        return this[OPERATIONS_KEY] || []
    }

    get queries() {
        return this[QUERIES_KEY] || []
    }

}

/**
 * Description @Action Action decorator to specify actions available on a contract, returning object must match param names exactly.
 * 
 * @param {String} serviceName - E.g. 'account-sys', 'invite-sys' 
 * @param {String} sender - Function to define the optional sender param 
 * 
 */
export function Action(serviceName: string, sender: (params?: any) => string | undefined = () => undefined) {
    return function (target, key, descriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = function (...args) {
            const result = originalMethod.apply(this, args);
            const theSender = sender(result);

            console.log({ application: serviceName, actionName: key, params: result, sender: theSender})
            return action(serviceName, key, result, theSender)
        }
    }
};

/**
 * Description: @Op Operation decorator which helps build { id: .., exec: () => ..}
 * 
 *
 * @param {String} [name] - The optional id of the operation, will otherwise default to the method name.
 */
export function Op(name?: string) {
    return function (target, key, descriptor) {
        const id = name ? name : key;
        const op = {
            exec: descriptor.value.bind(target),
            id
        };
        const isExistingArray = OPERATIONS_KEY in target;
        if (isExistingArray) {
            target[OPERATIONS_KEY].push(op)
        } else {
            target[OPERATIONS_KEY] = [op]
        }

        descriptor.value = function (...args) {
            const parent = 'getAppletId' in Object.getPrototypeOf(this) ? Object.getPrototypeOf(this) : Object.getPrototypeOf(Object.getPrototypeOf(this))
            return parent.getAppletId().then(appletId => operation(appletId, id, ...args)).then(res => {
                if (resIsQueryResponse(res)) {
                    console.log('is thing')
                    return res.transactionSubmittedPromise;
                } else {
                    console.log('is not this thing')
                    return res;
                }
            })
        }
    };
}

interface ActionTrace {
    action: any;
    error: null | string;
    innerTraces: any[];
    rawTerval: string;
}

interface QueryResponse<T = any> {
    transactionId: number;
    transactionSubmittedPromise: Promise<{ actionTraces: ActionTrace[], error: null }>
}
const resIsQueryResponse = (res: unknown): res is QueryResponse => {
    return typeof res === 'object' && res !== null && 'transactionId' in res;
}



/**
 * Description: @Qry Query decorator which helps build { id: .., exec: () => ..}
 * 
 *
 * @param {String} name - The optional id of the query, will otherwise default to the method name.
 */
export function Qry(name) {
    return function (target, key, descriptor) {
        const id = name ? name : key;
        const op = {
            exec: descriptor.value.bind(target),
            id
        };
        const isExistingArray = QUERIES_KEY in target;
        if (isExistingArray) {
            target[QUERIES_KEY].push(op)
        } else {
            target[QUERIES_KEY] = [op]
        }

        descriptor.value = function (...args) {
            const parent = 'getAppletId' in Object.getPrototypeOf(this) ? Object.getPrototypeOf(this) : Object.getPrototypeOf(Object.getPrototypeOf(this))
            return parent.getAppletId().then(appletId => query(appletId, id, ...args))
        }
    };
}



export class PsiboardService extends Service {

    @Action('invite-sys')
    delInvite(inviteKey: string) {
        return { inviteKey }
    }

    @Action('invite-sys')
    getInvite(pubkey: string) {
        return { pubkey }
    }

    @Action('invite-sys', () => 'invited-sys')
    acceptCreate(inviteKey: string, newAccountName: string, newAccountKey: string) {
        return { inviteKey, newAccountName, newAccountKey};
    }

    @Action('invite-sys')
    accept(inviteKey: string) {
        return { inviteKey }
    }

    @Action('invite-sys')
    createInvite(
        inviteKey: string,
    ) {
        console.log({ inviteKey }, "TX")
        return {
            inviteKey,
        };
    }

    @Op()
    acceptInvite(inviteKey: string) {
        this.accept(inviteKey);
    }

    @Op()
    fetchInvite(inviteKey: string) {
        return this.getInvite(inviteKey)
    }

    @Op()
    createAccount({ token, accountName, publicKey }: { token: string, accountName: string, publicKey: string }) {
        this.acceptCreate(token, accountName, publicKey);
    }

    @Op()
    async makeInvite({ publicKey }: { publicKey: string }) {
        return this.createInvite(publicKey)
    }

}

export const psiboardApplet = new PsiboardService();
