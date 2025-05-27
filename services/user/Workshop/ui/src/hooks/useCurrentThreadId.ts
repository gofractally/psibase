import { useParams } from "react-router-dom";
import { z } from "zod";

export const useCurrentThreadId = (): string | undefined => {
  const { threadId } = useParams();
  return z.string().parse(threadId);
};
