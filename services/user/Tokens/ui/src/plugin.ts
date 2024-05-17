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

  public burn(
    tokenId: number,
    amount: string,
    memo?: string,
    account?: string
  ) {
    return this.addIntf({
      method: "burn",
      params: z
        .tuple([
          z.number(),
          z.string(),
          z.string().default(""),
          z.string().default(""),
        ])
        .parse([tokenId, amount, memo, account]),
    });
  }

  public mint(tokenId: number, amount: string, memo: string) {
    return this.addIntf({
      method: "mint",
      params: z
        .tuple([z.number(), z.string(), z.string()])
        .parse([tokenId, amount, memo]),
    });
  }
}

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
      params: z
        .tuple([z.number(), z.string(), z.string(), z.string().default("")])
        .parse([tokenId, receiver, amount, memo]),
    });
  }

  public uncredit(
    tokenId: number,
    receiver: string,
    amount: string,
    memo: string = ""
  ) {
    return this.addIntf({
      method: "uncredit",
      params: z
        .tuple([z.number(), z.string(), z.string(), z.string()])
        .parse([tokenId, receiver, amount, memo]),
    });
  }

  public debit(
    tokenId: number,
    sender: string,
    amount: string,
    memo: string = ""
  ) {
    return this.addIntf({
      method: "debit",
      params: z
        .tuple([z.number(), z.string(), z.string(), z.string()])
        .parse([tokenId, sender, amount, memo]),
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
