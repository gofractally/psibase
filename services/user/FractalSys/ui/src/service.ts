import {
  action,
  AppletId,
  getJson,
  operation,
  query,
  uint8ArrayToHex,
} from "common/rpc.mjs";

const OPERATIONS_KEY = "OPERATIONS_KEY";
const QUERIES_KEY = "QUERIES_KEY";

/**
 * Description: Class to blueprint the applets contract + operations.
 */
export class Service {
  cachedApplet = "";

  constructor() {
    this.applet();
  }

  async applet() {
    if (this.cachedApplet) return this.cachedApplet;
    const appletName = await getJson("/common/thisservice");
    console.log(appletName, "is the applet name");
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
    return this[OPERATIONS_KEY] || [];
  }

  get queries() {
    return this[QUERIES_KEY] || [];
  }
}

/**
 * Description @Action Action decorator to specify actions available on a contract, returning object must match param names exactly.
 *
 * @param {String} serviceName - E.g. 'account-sys', 'invite-sys'
 * @param {String} sender - Function to define the optional sender param
 *
 */
export function Action(
  serviceName: string,
  sender: (params?: any) => string | undefined = () => undefined
) {
  return function (target, key, descriptor) {
    const originalMethod = descriptor.value;
    descriptor.value = function (...args) {
      console.log(args, "are the args");
      const result = originalMethod.apply(this, args);
      const theSender = sender(result);

      console.log({
        application: serviceName,
        actionName: key,
        params: result,
        sender: theSender,
      });
      return action(serviceName, key, result, theSender);
    };
  };
}

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
      id,
    };
    const isExistingArray = OPERATIONS_KEY in target;
    if (isExistingArray) {
      target[OPERATIONS_KEY].push(op);
    } else {
      target[OPERATIONS_KEY] = [op];
    }

    descriptor.value = function (...args) {
      const parent =
        "getAppletId" in Object.getPrototypeOf(this)
          ? Object.getPrototypeOf(this)
          : Object.getPrototypeOf(Object.getPrototypeOf(this));
      return parent
        .getAppletId()
        .then((appletId) => operation(appletId, id, ...args))
        .then((res) => {
          if (resIsQueryResponse(res)) {
            return res.transactionSubmittedPromise;
          } else {
            console.log("is not this thing");
            return res;
          }
        });
    };
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
  transactionSubmittedPromise: Promise<{
    actionTraces: ActionTrace[];
    error: null;
  }>;
}
const resIsQueryResponse = (res: unknown): res is QueryResponse => {
  return typeof res === "object" && res !== null && "transactionId" in res;
};

/**
 * Description: @Qry Query decorator which helps build { id: .., exec: () => ..}
 *
 *
 * @param {String} name - The optional id of the query, will otherwise default to the method name.
 */
export function Qry(name?: string) {
  return function (target, key, descriptor) {
    const id = name ? name : key;
    const op = {
      exec: descriptor.value.bind(target),
      id,
    };
    const isExistingArray = QUERIES_KEY in target;
    if (isExistingArray) {
      target[QUERIES_KEY].push(op);
    } else {
      target[QUERIES_KEY] = [op];
    }

    descriptor.value = function (...args) {
      const parent =
        "getAppletId" in Object.getPrototypeOf(this)
          ? Object.getPrototypeOf(this)
          : Object.getPrototypeOf(Object.getPrototypeOf(this));
      return parent
        .getAppletId()
        .then((appletId) => query(appletId, id, ...args));
    };
  };
}

type PublicKey = string;
type AccountNumber = string;
type ActionRes = { [key: string]: any } | undefined;

const fractalSys: string = "fractal-sys";

export class FractalService extends Service {
  @Action(fractalSys)
  newFractal(
    name: AccountNumber,
    type: AccountNumber,
    prettyName: string
  ): ActionRes {
    return { name, type, prettyName };
  }

  @Action(fractalSys)
  createIdentity() {
    return {}
  }

  @Action(fractalSys)
  reject(inviteKey: PublicKey): ActionRes {
    return { inviteKey };
  }

  @Action(fractalSys)
  accept(inviteKey: PublicKey): ActionRes {
    return { inviteKey };
  }

  @Action(fractalSys)
  claim(inviteKey: string): ActionRes {
    return { inviteKey };
  }

  @Action(fractalSys)
  invite(fractal: AccountNumber, pubkey: PublicKey): ActionRes {
    return { fractal, pubkey };
  }

  @Action(fractalSys)
  newIdentity(name: AccountNumber, requireNew: boolean): ActionRes {
    return { name, requireNew };
  }

  @Op()
  async acceptInvite({ publicKey }: { publicKey: string}) {
    await this.claim(publicKey);
    this.accept(publicKey);
  }

  @Op()
  async makeIdentity() {
    this.createIdentity();
  }

  @Op()
  async createInvite({
    fractalId,
    publicKey,
  }: {
    fractalId: AccountNumber;
    publicKey: string;
  }) {
    this.invite(fractalId, publicKey);
  }

  @Op()
  async createFractal({
    name,
    type,
    prettyName,
  }: {
    name: AccountNumber;
    type: AccountNumber;
    prettyName: string;
  }) {
    this.newFractal(name, type, prettyName);
  }
}

export const fractalApplet = new FractalService();
