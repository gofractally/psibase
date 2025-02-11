import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useParams } from "react-router-dom";

export const Login = () => {
  const params = useParams();

  console.log(params, "are the params");

  const { data: currentUser } = useCurrentUser();

  console.log({ currentUser });

  return <div>You should login before {JSON.stringify(params)}</div>;
};
