import { FunctionCallArgs } from "@psibase/common-lib/messaging";

interface InternalArgs {
  method: string;
  params: any[];
  plugin?: string;
  intf?: string;
}

export abstract class Plugin {
  constructor(public serviceName: string) {
    if (!serviceName) throw new Error(`No service name found`);
  }

  protected addService(
    args: Omit<FunctionCallArgs, "service">
  ): FunctionCallArgs {
    return {
      ...args,
      service: this.serviceName,
    };
  }
}

export abstract class Interface extends Plugin {
  constructor(public interfaceName: string, serviceName: string) {
    super(serviceName);
  }

  protected addIntf(args: Omit<InternalArgs, "intf">): FunctionCallArgs {
    return this.addService({
      method: args.method,
      params: args.params,
      intf: this.interfaceName,
    });
  }
}
