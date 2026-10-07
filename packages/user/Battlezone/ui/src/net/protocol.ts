export const BATTLEZONE_SUBPROTOCOL_V1 = "psibase.battlezone.v1";
export const WS_TICKET_PREFIX = "psibase.ws-ticket.";

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
    | { t: "error"; code: string; reason: string };

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
    | { t: "stateSnapshot"; state: unknown };
