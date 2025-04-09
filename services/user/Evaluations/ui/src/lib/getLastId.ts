import { z } from "zod";
import { graphql } from "./graphql";

export const getLastId = async (): Promise<number> => {
    const res = await graphql(`{ getLastId }`, "evaluations")

    const response = z.object({
        data: z.object({
            getLastId: z.number()
        })
    }).parse(res)

    return response.data.getLastId;
}