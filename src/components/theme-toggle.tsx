import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  const Icon = mode === "dark" ? Moon : mode === "light" ? Sun : Monitor;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Toggle theme">
          <Icon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setMode("light")}><Sun className="h-4 w-4 mr-2" /> Light</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setMode("dark")}><Moon className="h-4 w-4 mr-2" /> Dark</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setMode("system")}><Monitor className="h-4 w-4 mr-2" /> System</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
