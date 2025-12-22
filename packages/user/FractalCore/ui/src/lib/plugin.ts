import type { Account } from "@shared/lib/schemas/account";

import { getSubDomain } from "@shared/lib/get-sub-domain";

// Shared call type with typed params
export type PluginCall<T extends unknown[] = unknown[]> = {
    readonly intf: string;
    readonly method: string;
    readonly service: Account;
    // Phantom for inference
    readonly _params?: T;
};

abstract class PluginInterface {
    protected abstract readonly _intf: string;

    // Will be set by Plugin constructor
    protected _service!: Account;

    protected _call<T extends unknown[] = []>(method: string): PluginCall<T> {
        return {
            intf: this._intf,
            method,
            service: this._service,
            _params: undefined,
        } as const;
    }
}

// === Interfaces ===

class AdminFractal extends PluginInterface {
    protected override readonly _intf = "adminFractal" as const;

    get exileMember() {
        return this._call<[member: Account]>("exileMember");
    }
    get setDistInterval() {
        return this._call<[interval: number]>("setDistInterval");
    }
    get setRankedGuildSlots() {
        return this._call<[slots: number]>("setRankedGuildSlots");
    }
    get setTokenThreshold() {
        return this._call<[threshold: number]>("setTokenThreshold");
    }
    get setRankedGuilds() {
        return this._call<[guilds: Account[]]>("setRankedGuilds");
    }
}

class UserFractal extends PluginInterface {
    protected override readonly _intf = "userFractal" as const;

    get join() {
        return this._call<[]>("join");
    }

    get distToken() {
        return this._call<[]>("distToken");
    }
}

class UserEval extends PluginInterface {
    protected override readonly _intf = "userEval" as const;

    get attest() {
        return this._call<[guildAccount: Account, groupNumber: number]>(
            "attest",
        );
    }
    get propose() {
        return this._call<
            [guildAccount: Account, groupNumber: number, proposal: string[]]
        >("propose");
    }
    get register() {
        return this._call<[guildAccount: Account]>("register");
    }
    get unregister() {
        return this._call<[guildAccount: Account]>("unregister");
    }
    get getGroupUsers() {
        return this._call<[guildAccount: Account, groupNumber: number]>(
            "getGroupUsers",
        );
    }
    get getProposal() {
        return this._call<[guildAccount: Account, groupNumber: number]>(
            "getProposal",
        );
    }
}

class AdminGuild extends PluginInterface {
    protected override readonly _intf = "adminGuild" as const;

    get createGuild() {
        return this._call<[displayName: string, account: Account]>(
            "createGuild",
        );
    }
    get setDisplayName() {
        return this._call<[guildAccount: Account, displayName: string]>(
            "setDisplayName",
        );
    }
    get setBio() {
        return this._call<[guildAccount: Account, bio: string]>("setBio");
    }
    get setDescription() {
        return this._call<[guildAccount: Account, description: string]>(
            "setDescription",
        );
    }
    get setSchedule() {
        return this._call<
            [
                guildAccount: Account,
                registration: number,
                deliberation: number,
                submission: number,
                finishBy: number,
                intervalSeconds: number,
            ]
        >("setSchedule");
    }
    get startEval() {
        return this._call<[guildAccount: Account]>("startEval");
    }
    get setGuildRep() {
        return this._call<[guildAccount: Account, rep: Account]>("setGuildRep");
    }
    get resignGuildRep() {
        return this._call<[guildAccount: Account]>("resignGuildRep");
    }
    get removeGuildRep() {
        return this._call<[guildAccount: Account]>("removeGuildRep");
    }
}

class UserGuild extends PluginInterface {
    protected override readonly _intf = "userGuild" as const;

    get applyGuild() {
        return this._call<[guildAccount: Account, app: string]>("applyGuild");
    }
    get attestMembershipApp() {
        return this._call<
            [
                guildAccount: Account,
                member: Account,
                comment: string,
                endorses: boolean,
            ]
        >("attestMembershipApp");
    }

    get registerCandidacy() {
        return this._call<[guildAccount: Account, active: boolean]>(
            "registerCandidacy",
        );
    }
}

export class Plugin {
    readonly adminFractal: AdminFractal;
    readonly userFractal: UserFractal;
    readonly userEval: UserEval;
    readonly adminGuild: AdminGuild;
    readonly userGuild: UserGuild;

    constructor(readonly service: Account) {
        // Initialize all interfaces with the correct service
        this.adminFractal = new AdminFractal();
        this.userFractal = new UserFractal();
        this.userEval = new UserEval();
        this.adminGuild = new AdminGuild();
        this.userGuild = new UserGuild();

        // Set the protected _service on each instance
        // This avoids the "used before initialization" error
        const instances = [
            this.adminFractal,
            this.userFractal,
            this.userEval,
            this.adminGuild,
            this.userGuild,
        ] as PluginInterface[];

        for (const instance of instances) {
            Object.assign(instance, { _service: service });
        }
    }
}

// Global instances
export const fractalCorePlugin = new Plugin(getSubDomain());
