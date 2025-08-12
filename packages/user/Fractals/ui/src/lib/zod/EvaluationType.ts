import { z } from "zod";

export enum EvalType {
    Reputation = 1,
    Favor = 2,
}

export const zEvalType = z.nativeEnum(EvalType);
