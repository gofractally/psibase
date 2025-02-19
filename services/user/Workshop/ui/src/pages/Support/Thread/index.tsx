import { useParams } from "react-router-dom";

export const Thread = () => {
  const params = useParams();

  return (
    <div>
      thread here!
      {JSON.stringify(params)}
    </div>
  );
};
