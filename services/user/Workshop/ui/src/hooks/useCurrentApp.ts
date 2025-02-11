import { useLocation } from "react-router-dom";

export const useCurrentApp = () => {
  const location = useLocation();
  return location.pathname.split("/")[2];
};
