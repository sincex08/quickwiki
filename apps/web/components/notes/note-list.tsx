import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Note } from "@quickwiki/shared";
import { NoteCard } from "./note-card";

interface NoteListProps {
  notes: Note[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  activeNoteId: string | null;
  /** 紧凑模式：卡片只展示标题 */
  compact?: boolean;
  onSelect: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onRequestDelete: (note: Note) => void;
}

export function NoteList({
  notes,
  loading,
  hasMore,
  onLoadMore,
  activeNoteId,
  compact = false,
  onSelect,
  onTogglePin,
  onRequestDelete,
}: NoteListProps) {
  if (loading) {
    return (
      <div className="space-y-2 p-3" aria-label="加载中">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="mt-2 h-3 w-full" />
            <Skeleton className="mt-1 h-3 w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2 p-3">
      {notes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          active={note.id === activeNoteId}
          compact={compact}
          onSelect={() => onSelect(note.id)}
          onTogglePin={() => onTogglePin(note.id, note.pinned)}
          onDelete={() => onRequestDelete(note)}
        />
      ))}
      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-muted-foreground"
          onClick={onLoadMore}
        >
          加载更多
        </Button>
      )}
    </div>
  );
}
