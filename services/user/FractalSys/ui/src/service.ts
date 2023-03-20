import {
  action,
  AppletId,
  getJson,
  operation,
  query,
} from "@psibase/common-lib";

const OPERATIONS_KEY = "OPERATIONS_KEY";
const QUERIES_KEY = "QUERIES_KEY";

/**
 * Description: Class to blueprint the applets contract + operations.
 */
export class Service {
  public cachedApplet = "";

  constructor() {
    this.applet();
  }

  async applet() {
    if (this.cachedApplet) {
      return this.cachedApplet
    } else {
      const appletName = await getJson("/common/thisservice");
      this.cachedApplet = appletName;
      return appletName;
    }
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

      console.log('calling action...', {
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

interface FractalSettings {
  name: AccountNumber
  displayName?: string;
  description?: string;
  languageCode?: string;
}

interface CreateFractalParams extends FractalSettings {
    name: AccountNumber;
    type: AccountNumber;
}

const keyToAction: { [key: string]: string } = {
  displayName: 'setFracName',
  description: 'setFracDesc',
  languageCode: 'setFracLang'
}

class FractalService extends Service {


  @Action(fractalSys)
  setFracName(fractalAccount: AccountNumber, displayName: string) {
    return { fractalAccount, displayName }
  }

  @Action(fractalSys)
  setFracDesc(fractalAccount: AccountNumber, description: string) {
    return { fractalAccount, description }
  }

  @Action(fractalSys)
  setFracLang(fractalAccount: AccountNumber, languageCode: string) {
    return { fractalAccount, languageCode }
  }

  @Action(fractalSys)
  newFractal(
    name: AccountNumber,
    type: AccountNumber,
  ): ActionRes {
    console.log('inside action called');
    return { name, type };
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
  async claimInvite({ publicKey }: { publicKey: string }) {
    this.claim(publicKey)
  }

  @Op()
  async acceptInvite({ publicKey }: { publicKey: string}) {
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
  async createFractal(params: CreateFractalParams) {
    console.log('calling action...')
    this.newFractal(params.name, params.type);
    // await new Promise(resolve => setTimeout(resolve, 2000))
    // this.updateFractal(params)
  }

  @Op()
  async updateFractal(settings: FractalSettings) {

    for (const key in settings) {
      const method = keyToAction[key];
      if (method) {
        await this[method](settings.name, settings[key])
      }
    }
  }
}


export const fractalApplet = new FractalService();
