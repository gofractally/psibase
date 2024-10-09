import { Interface } from "./plugin-abstract";
// import { z } from "zod";

class Intf extends Interface {
    constructor(service: string) {
        super("intf", service);
    }

    public setMetadata(
        name: string,
        short_description: string,
        long_description: string,
        icon: string,
        tos_subpage: string,
        privacy_policy_subpage: string,
        app_homepage_subpage: string,
        status: string,
    ) {
        return this.addIntf({
            method: "set_app_metadata",
            params: [
                name,
                short_description,
                long_description,
                icon,
                tos_subpage,
                privacy_policy_subpage,
                app_homepage_subpage,
                status,
            ],
        });
    }

    // public burn(
    //   tokenId: string | number,
    //   amount: string,
    //   memo?: string,
    //   account?: string
    // ) {
    //   return this.addIntf({
    //     method: "burn",
    //     params: z
    //       .tuple([
    //         z.string(),
    //         z.string(),
    //         z.string().default(""),
    //         z.string().default(""),
    //       ])
    //       .parse([tokenId.toString(), amount, memo, account]),
    //   });
    // }

    // public mint(tokenId: string | number, amount: string, memo: string) {
    //   return this.addIntf({
    //     method: "mint",
    //     params: z
    //       .tuple([z.string(), z.string(), z.string()])
    //       .parse([tokenId.toString(), amount, memo]),
    //   });
    // }
}

// class Transfer extends Interface {
//   constructor(service: string) {
//     super("transfer", service);
//   }

//   public credit(
//     tokenId: string | number,
//     receiver: string,
//     amount: string,
//     memo: string = ""
//   ) {
//     return this.addIntf({
//       method: "credit",
//       params: z
//         .tuple([z.string(), z.string(), z.string(), z.string().default("")])
//         .parse([tokenId.toString(), receiver, amount, memo]),
//     });
//   }

//   public uncredit(
//     tokenId: string | number,
//     receiver: string,
//     amount: string,
//     memo: string = ""
//   ) {
//     return this.addIntf({
//       method: "uncredit",
//       params: z
//         .tuple([z.string(), z.string(), z.string(), z.string()])
//         .parse([tokenId.toString(), receiver, amount, memo]),
//     });
//   }

//   public debit(
//     tokenId: string | number,
//     sender: string,
//     amount: string,
//     memo: string = ""
//   ) {
//     return this.addIntf({
//       method: "debit",
//       params: z
//         .tuple([z.string(), z.string(), z.string(), z.string()])
//         .parse([tokenId.toString(), sender, amount, memo]),
//     });
//   }
// }

class Plugin {
    constructor(service: string) {
        // this.transfer = new Transfer(service);
        this.intf = new Intf(service);
    }

    // public transfer!: Transfer;
    public intf!: Intf;
}

export const workshopPlugin = new Plugin("workshop");
