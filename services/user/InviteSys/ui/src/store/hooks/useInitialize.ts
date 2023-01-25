import { initializeApplet, setOperations, setQueries } from "common/rpc.mjs";
import { useEffect } from "react";
import { Service } from "service";

export const useInitilize = (service: Service) => {
    useEffect(() => {
        initializeApplet();
        setQueries(service.queries);
        setOperations(service.operations);
    }, []);
}