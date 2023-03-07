import {
  initializeApplet,
  AppletId,
  setOperations,
  setQueries,
  operation,
} from "common/rpc.mjs";

import { useEffect } from "react";
import { Service } from "service";
import { extractInviteTokenKeyPair } from "store/token";

export const useInitilize = (service: Service) => {
  useEffect(() => {
    initializeApplet(async () => {
      setQueries(service.queries);
      setOperations(service.operations);
    });
  }, []);
};

