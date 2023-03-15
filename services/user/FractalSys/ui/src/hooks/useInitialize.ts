import { initializeApplet, setOperations, setQueries } from "@psibase/common-lib";
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
