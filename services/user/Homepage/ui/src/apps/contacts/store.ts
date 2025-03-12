import { z } from "zod";
import { Account } from "@/lib/zod/Account";
import { Contact } from "./types";

export const ContactsDb = new Map<string, Contact[]>();

export const getContacts = (
    username?: z.infer<typeof Account> | null | undefined,
) => (username ? (ContactsDb.get(username) ?? []) : []);
