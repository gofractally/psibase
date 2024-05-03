import { Interface } from "./plugin-abstract";

class Intf extends Interface {
  constructor(service: string) {
    super("intf", service);
  }

  public createToken(precision: number, maxSupply: number) {
    return this.addIntf({
      method: "create",
      params: [precision, maxSupply],
    });
  }
}

class Transfer extends Interface {
  constructor(service: string) {
    super("transfer", service);
  }

  public credit() {
    return this.addIntf({
      method: "credit",
      params: [1],
    });
  }
}

class Plugin {
  constructor(service: string) {
    this.transfer = new Transfer(service);
    this.intf = new Intf(service);
  }

  public transfer!: Transfer;
  public intf!: Intf;
}

export const tokenPlugin = new Plugin("tokens");
