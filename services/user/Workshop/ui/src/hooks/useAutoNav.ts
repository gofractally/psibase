import { useLocalStorage } from "@uidotdev/usehooks";

export const useAutoNavigate = () => useLocalStorage("autoNavigate", true);
