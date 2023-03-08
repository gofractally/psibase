import { initializeApplet, setOperations, setQueries } from "common/rpc.mjs";
import { useEffect } from "react";
import { Service } from "service";

export const useInitialize = (service: Service) => {
  useEffect(() => {
    initializeApplet(async () => {
      setQueries(service.queries);
      setOperations(service.operations);
    });
  }, []);
};
