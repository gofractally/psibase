import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tab, TabType } from "@/hooks/useTab";
import { ArrowRight, Flame, Plus } from "lucide-react";

interface TransferProps {
  tab: TabType;
  isAdmin: boolean;
  setMode: (tab: TabType) => void;
}

export function TransferToggle({ tab, setMode, isAdmin }: TransferProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="flex gap-3" variant="outline">
          {tab}
          {tab == Tab.Enum.Transfer && (
            <ArrowRight className="h-[1.2rem] w-[1.2rem]" />
          )}
          {tab == Tab.Enum.Burn && <Flame className="h-[1.2rem] w-[1.2rem]" />}
          {tab == Tab.Enum.Mint && <Plus className="h-[1.2rem] w-[1.2rem]" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setMode(Tab.Enum.Transfer)}>
          Transfer
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setMode(Tab.Enum.Burn)}>
          Burn
        </DropdownMenuItem>
        {isAdmin && (
          <>
            <DropdownMenuItem onClick={() => setMode(Tab.Enum.Mint)}>
              Mint
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setMode(Tab.Enum.Mint)}>
              Map Symbol
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
