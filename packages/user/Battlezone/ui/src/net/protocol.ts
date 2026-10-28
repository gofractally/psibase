export const BATTLEZONE_SUBPROTOCOL_V1 = "psibase.battlezone.v1";

export type PresenceStatus = "online" | "offline";

export type PeerPresence = {
    account: string;
    presence: PresenceStatus;
};

export type RosterSlot = {
    tankId: string;
    controller: string;
    account?: string;
};

export type LobbyPlayer = {
    account: string;
    ready: boolean;
};

export type BanxLockWire = {
    a: string;
    b: string;
    aPays: string;
    aAsset: number;
    aSymbol: string;
    bPays: string;
    bAsset: number;
    bSymbol: string;
    aMinReturn: string;
    bMinReturn: string;
};

export type ServerFrame =
    | { t: "welcome"; user: string; serverTime: number }
    | { t: "presenceSnapshot"; peers: PeerPresence[] }
    | { t: "presence"; account: string; status: PresenceStatus }
    | {
          t: "lobby";
          host: string;
          enemyCount: number;
          slots: string[];
          players: LobbyPlayer[];
      }
    | {
          t: "matchStarted";
          host: string;
          enemyCount: number;
          roster: RosterSlot[];
          banxLocks?: BanxLockWire[];
      }
    | { t: "roster"; roster: RosterSlot[] }
    | {
          t: "input";
          from: string;
          tankId: string;
          turn: number;
          throttle: number;
          fire: boolean;
      }
    | { t: "stateSnapshot"; state: unknown }
    | { t: "matchEnded" }
    | { t: "error"; code: string; reason: string }
    | {
          t: "banxStatus";
          from: string;
          on: boolean;
          assetId: number;
          units: string;
          symbol: string;
      }
    | {
          t: "banxOffer";
          from: string;
          to: string;
          requiredUnits: string;
          requiredAsset: number;
          requiredSymbol: string;
          matchPeerUnits: string;
          matchPeerAsset: number;
          matchPeerSymbol: string;
          lock: BanxLockWire;
      }
    | {
          t: "banxOfferReply";
          from: string;
          to: string;
          accept: boolean;
          lock?: BanxLockWire;
      }
    | { t: "banxLock"; lock: BanxLockWire }
    | {
          t: "banxHit";
          hitId: number;
          victim: string;
          shooter: string;
      };

export type ClientFrame =
    | { t: "hello" }
    | { t: "ready"; enemyCount: number; slots: string[] }
    | { t: "unready" }
    | { t: "leaveMatch" }
    | {
          t: "input";
          tankId: string;
          turn: number;
          throttle: number;
          fire: boolean;
      }
    | { t: "stateSnapshot"; state: unknown }
    | {
          t: "banxStatus";
          on: boolean;
          assetId: number;
          units: string;
          symbol: string;
      }
    | {
          t: "banxOffer";
          to: string;
          requiredUnits: string;
          requiredAsset: number;
          requiredSymbol: string;
          matchPeerUnits: string;
          matchPeerAsset: number;
          matchPeerSymbol: string;
          lock: BanxLockWire;
      }
    | {
          t: "banxOfferReply";
          to: string;
          accept: boolean;
          lock?: BanxLockWire;
      }
    | { t: "banxLock"; lock: BanxLockWire }
    | {
          t: "banxHit";
          hitId: number;
          victim: string;
          shooter: string;
      };
