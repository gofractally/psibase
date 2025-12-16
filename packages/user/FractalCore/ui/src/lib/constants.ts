import type { Account } from "@/lib/zod/Account";

import { getSubDomain } from "@shared/lib/get-sub-domain";

import { zAccount } from "./zod/Account";

export const evaluationsService = zAccount.parse("evaluations");
export const fractalsService = zAccount.parse("fractals");

type MethodCall = {
    readonly intf: string;
    readonly method: string;
    readonly service: Account;
};

abstract class PluginInterface {
    protected abstract readonly _intf: string;
    protected readonly _service: Account;

    constructor(service: Account) {
        this._service = service;
    }

    protected _call(method: string): MethodCall {
        return {
            intf: this._intf,
            method,
            service: this._service,
        } as const;
    }
}

class AdminFractal extends PluginInterface {
    protected override readonly _intf = "adminFractal" as const;

    constructor(service: Account) {
        super(service);
    }

    get exileMember() {
        return this._call("exileMember");
    }
    get setDistInterval() {
        return this._call("setDistInterval");
    }
    get setRankedGuildSlots() {
        return this._call("setRankedGuildSlots");
    }
    get setMinScorers() {
        return this._call("setMinScorers");
    }
}

class UserFractal extends PluginInterface {
    protected override readonly _intf = "userFractal" as const;
    constructor(service: Account) {
        super(service);
    }

    get join() {
        return this._call("join");
    }
}

class UserEval extends PluginInterface {
    protected override readonly _intf = "userEval" as const;
    constructor(service: Account) {
        super(service);
    }

    get attest() {
        return this._call("attest");
    }
    get propose() {
        return this._call("propose");
    }
    get register() {
        return this._call("register");
    }
    get unregister() {
        return this._call("unregister");
    }
    get getGroupUsers() {
        return this._call("getGroupUsers");
    }
    get getProposal() {
        return this._call("getProposal");
    }
}

class BaseAdminGuild extends PluginInterface {
    protected override readonly _intf = "adminGuild" as const;
    constructor(service: Account) {
        super(service);
    }

    get createGuild() {
        return this._call("createGuild");
    }
    get setDisplayName() {
        return this._call("setDisplayName");
    }
    get setBio() {
        return this._call("setBio");
    }
    get setDescription() {
        return this._call("setDescription");
    }
    get setSchedule() {
        return this._call("setSchedule");
    }
    get startEval() {
        return this._call("startEval");
    }
    get closeEval() {
        return this._call("closeEval");
    }
    get setGuildRep() {
        return this._call("setGuildRep");
    }
    get resignGuildRep() {
        return this._call("resignGuildRep");
    }
    get removeGuildRep() {
        return this._call("removeGuildRep");
    }
}

class UserGuild extends PluginInterface {
    protected override readonly _intf = "userGuild" as const;
    constructor(service: Account) {
        super(service);
    }

    get applyGuild() {
        return this._call("applyGuild");
    }
    get attestMembershipApp() {
        return this._call("attestMembershipApp");
    }
}

export class Plugin {
    readonly adminFractal: AdminFractal;
    readonly userFractal: UserFractal;
    readonly userEval: UserEval;
    readonly adminGuild: BaseAdminGuild;
    readonly userGuild: UserGuild;

    constructor(readonly service: Account) {
        this.adminFractal = new AdminFractal(service);
        this.userFractal = new UserFractal(service);
        this.userEval = new UserEval(service);
        this.adminGuild = new BaseAdminGuild(service);
        this.userGuild = new UserGuild(service);
    }
}

export const fractalCorePlugin = new Plugin(getSubDomain());
export const evaluationsPlugin = new Plugin(evaluationsService);
