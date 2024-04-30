import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowRight, Flame, Plus, Merge } from "lucide-react";

export enum Mode {
  Transfer = "Transfer",
  Burn = "Burn",
  Mint = "Mint",
  MapSymbol = "MapSymbol",
}

interface TransferProps {
  mode: Mode;
  isAdmin: boolean;
  setMode: (mode: Mode) => void;
}

export function TransferToggle({ mode, setMode, isAdmin }: TransferProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="flex gap-3" variant="outline">
          {mode}
          {mode == Mode.Transfer && (
            <ArrowRight className="h-[1.2rem] w-[1.2rem]" />
          )}
          {mode == Mode.Burn && <Flame className="h-[1.2rem] w-[1.2rem]" />}
          {mode == Mode.Mint && <Plus className="h-[1.2rem] w-[1.2rem]" />}
          {mode == Mode.MapSymbol && (
            <Merge className="h-[1.2rem] w-[1.2rem]" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setMode(Mode.Transfer)}>
          Transfer
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setMode(Mode.Burn)}>
          Burn
        </DropdownMenuItem>
        {isAdmin && (
          <>
            <DropdownMenuItem onClick={() => setMode(Mode.Mint)}>
              Mint
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setMode(Mode.Mint)}>
              Map Symbol
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
