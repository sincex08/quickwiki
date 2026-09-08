"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookMarked, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

/** 移动端底部导航（< md 断点显示） */
export function MobileNav() {
  const pathname = usePathname();

  const items = [
    { href: "/notes", label: "笔记", icon: FileText },
    { href: "/notebooks", label: "笔记本", icon: BookMarked },
  ];

  return (
    <nav
      className="flex shrink-0 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="底部导航"
    >
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs transition-colors",
              active ? "text-primary" : "text-muted-foreground"
            )}
          >
            <Icon className="h-5 w-5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
