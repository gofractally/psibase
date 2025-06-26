import { TriangleAlert } from "lucide-react";
import { Button } from "@shared/shadcn/ui/button";
interface Props {
  onContinue: () => void;
}

export const NoTokensWarning = ({ onContinue }: Props) => {
  return (
    <div className="relative w-full rounded-lg border p-4 flex justify-between">
      <div className="my-auto flex gap-2">
        <div className="h-full my-auto">
          <TriangleAlert className="h-4 w-4 text-yellow-500" />
        </div>
        <div>
          <div className="">Heads up!</div>
          <div className="text-sm text-muted-foreground">
            You currently have no token balances or tokens to administer.
          </div>
          <div className="text-sm text-muted-foreground">
            Receive some tokens or create a token to continue.
          </div>
        </div>
      </div>
      <div className="my-auto">
        <Button onClick={() => onContinue()}>Create token</Button>
      </div>
    </div>
  );
};
