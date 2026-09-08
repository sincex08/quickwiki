import { Tag } from "lucide-react";
import { cn } from "@/lib/utils";

export function TagBadge({
  tag,
  className,
  onClick,
}: {
  tag: string;
  className?: string;
  onClick?: () => void;
}) {
  const Comp = onClick ? "button" : "span";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground",
        onClick && "cursor-pointer hover:bg-secondary/70",
        className
      )}
    >
      <Tag className="h-2.5 w-2.5" />
      {tag}
    </Comp>
  );
}
