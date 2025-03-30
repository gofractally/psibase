


import { z } from "zod";
import { graphql } from "./graphql";
import { Account } from "./zod/Account";


export const getUsers = async (evaluationId: number) => {
    const res = await graphql(`{ getUsers(id: ${evaluationId}) { user groupNumber } }`, "evaluations")

    const response = z.object({
        data: z.object({
            getUsers: z.object({
                user: Account,
                groupNumber: z.number().nullable(),
            }).array()
        })
    }).parse(res)

    return response.data.getUsers;
}