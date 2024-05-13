import { Interface } from "./plugin-abstract";
import { z } from "zod";

class Intf extends Interface {
  constructor(service: string) {
    super("intf", service);
  }

  public create(precision: number, maxSupply: string) {
    return this.addIntf({
      method: "create",
      params: [precision, maxSupply],
    });
  }

  public burn(tokenId: string, amount: string) {
    return this.addIntf({
      method: "burn",
      params: [tokenId, amount],
    });
  }

  public mint(tokenId: string, amount: string, memo: string) {
    return this.addIntf({
      method: "mint",
      params: [tokenId, amount, memo],
    });
  }
}

const CreditParams = z.tuple([
  z.number(),
  z.string(),
  z.string(),
  z.string().default(""),
]);

class Transfer extends Interface {
  constructor(service: string) {
    super("transfer", service);
  }

  public credit(
    tokenId: number,
    receiver: string,
    amount: string,
    memo: string = ""
  ) {
    return this.addIntf({
      method: "credit",
      params: CreditParams.parse([tokenId, receiver, amount, memo]),
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
