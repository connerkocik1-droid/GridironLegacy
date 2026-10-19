"use client";

import type { DraggableAttributes, DraggableSyntheticListeners, DragEndEvent } from "@dnd-kit/core";
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export interface DragHandleProps {
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
}

/**
 * A reorderable list, for the commissioner's boards.
 *
 * The drag handle is handed to the caller rather than wrapping the whole row,
 * because a row holds a record field and a remove button that both need to
 * keep working as ordinary clickable, typeable things — a row that is itself
 * the drag target steals those gestures.
 */
export function SortableList<T>({
  items,
  getId,
  onReorder,
  renderRow,
}: {
  items: T[];
  getId: (item: T) => string;
  onReorder: (next: T[]) => void;
  renderRow: (item: T, index: number, handle: DragHandleProps) => React.ReactNode;
}) {
  // A small move threshold, so tapping a record field or the remove button
  // does not get mistaken for the start of a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((it) => getId(it) === active.id);
    const to = items.findIndex((it) => getId(it) === over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(items, from, to));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map(getId)} strategy={verticalListSortingStrategy}>
        {items.map((item, i) => (
          <SortableRow key={getId(item)} id={getId(item)}>
            {(handle) => renderRow(item, i, handle)}
          </SortableRow>
        ))}
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  id,
  children,
}: {
  id: string;
  children: (handle: DragHandleProps) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        position: "relative",
        zIndex: isDragging ? 1 : "auto",
      }}
    >
      {children({ attributes, listeners })}
    </div>
  );
}

/** The grip a row's drag handle actually looks like. */
export function GripHandle(props: DragHandleProps) {
  return (
    <span
      {...props.attributes}
      {...props.listeners}
      aria-label="Drag to reorder"
      style={{
        cursor: "grab",
        touchAction: "none",
        flex: "0 0 auto",
        width: 20,
        height: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-faint)",
        fontSize: 14,
        letterSpacing: "-1px",
        userSelect: "none",
      }}
    >
      ⠿
    </span>
  );
}
