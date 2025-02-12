import { Account } from "@/lib/zodTypes";
import { useLocation } from "react-router-dom";
import { z } from "zod";

export const useCurrentApp = (): z.infer<typeof Account> | undefined => {
  const location = useLocation();
  const parsed = Account.safeParse(location.pathname.split("/")[2]);
  return parsed.success ? parsed.data : undefined;
};
