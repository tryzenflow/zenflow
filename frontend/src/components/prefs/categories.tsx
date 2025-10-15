import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { X, Plus, GripVertical } from "lucide-react";
import { Input } from "@/components/ui/input";
import { CategoryItem } from "../../types/prefs";

interface CategoriesPrefProps {
  categories: CategoryItem[];
  setCategories: React.Dispatch<React.SetStateAction<CategoryItem[]>>;
}

export function CategoriesPref({
  categories,
  setCategories,
}: CategoriesPrefProps) {
  const [newCategoryName, setNewCategoryName] = useState("");
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);

  // State to track the ID of the item currently being dragged *over*
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    setCategories((prev) => prev.filter((c) => c.id !== id));
  };

  const handleAdd = () => {
    if (newCategoryName.trim()) {
      const newCategory: CategoryItem = {
        id: Date.now().toString(),
        name: newCategoryName.trim(),
        isEditable: false,
      };
      setCategories((prev) => [...prev, newCategory]);
      setNewCategoryName("");
    }
  };

  const handleEditToggle = (id: string, editing: boolean) => {
    setCategories((prev) =>
      prev.map((c) => (c.id === id ? { ...c, isEditable: editing } : c))
    );
  };

  const handleNameChange = (id: string, newName: string) => {
    setCategories((prev) =>
      prev.map((c) => (c.id === id ? { ...c, name: newName } : c))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
  };

  // --- Drag & Drop Implementation with Animation ---

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, id: string) => {
    setDraggedItemId(id);
    e.dataTransfer.setData("text/plain", id);
    // Add visual feedback to the item being dragged
    e.currentTarget.classList.add("opacity-50", "shadow-xl");
  };

  const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
    setDraggedItemId(null);
    setDragOverItemId(null); // Clear all visual cues
    e.currentTarget.classList.remove("opacity-50", "shadow-xl");
  };

  const handleDragEnter = (id: string) => {
    if (draggedItemId !== id) {
      setDragOverItemId(id); // Set the item being hovered over
    }
  };

  const handleDragLeave = () => {
    setDragOverItemId(null); // Clear when leaving an item
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); // Essential to allow a drop
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetId: string) => {
    e.preventDefault();
    setDragOverItemId(null); // Clear hover state

    if (!draggedItemId || draggedItemId === targetId) return;

    const sourceIndex = categories.findIndex((c) => c.id === draggedItemId);
    const targetIndex = categories.findIndex((c) => c.id === targetId);

    if (sourceIndex === -1 || targetIndex === -1) return;

    const newCategories = Array.from(categories);
    const [movedItem] = newCategories.splice(sourceIndex, 1);
    newCategories.splice(targetIndex, 0, movedItem);

    setCategories(newCategories);
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2 className="text-2xl font-bold mb-1">Customize categories</h2>
      <p className="text-muted-foreground mb-6">
        Add, edit, delete categories, or drag the grip icon to reorder.
      </p>

      <div className="space-y-2 mb-6">
        {categories.map((category) => {
          // Determine border style for visual cue on drag over
          const isDragOver =
            dragOverItemId === category.id && draggedItemId !== category.id;
          const borderClass = isDragOver
            ? "border-primary ring-2 ring-primary/50"
            : "border-border";

          return (
            <div
              key={category.id}
              onDragOver={handleDragOver}
              onDragEnter={() => handleDragEnter(category.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, category.id)}
              // Apply CSS transitions for smooth movement
              className={`flex items-center justify-between px-3 py-2 rounded-lg bg-card shadow-sm border ${borderClass} transition-all duration-300 ease-in-out`}
            >
              {/* DnD Handle */}
              <div
                draggable // Only the handle is draggable
                onDragStart={(e) => handleDragStart(e, category.id)}
                onDragEnd={handleDragEnd}
                className="cursor-grab mr-3 touch-none"
              >
                <GripVertical className="h-5 w-5 text-muted-foreground" />
              </div>

              {category.isEditable ? (
                <Input
                  value={category.name}
                  onChange={(e) =>
                    handleNameChange(category.id, e.target.value)
                  }
                  onBlur={() => handleEditToggle(category.id, false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleEditToggle(category.id, false);
                    }
                  }}
                  autoFocus
                  className="flex-grow h-8"
                />
              ) : (
                <span
                  className="flex-grow cursor-pointer truncate"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    handleEditToggle(category.id, true);
                  }}
                >
                  {category.name}
                </span>
              )}

              {/* Action Buttons */}
              <div className="flex items-center ml-auto space-x-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(category.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}

        {/* Add New Category */}
        <div className="flex items-center gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleAdd}
            disabled={!newCategoryName.trim()}
          >
            <Plus className="h-5 w-5" />
          </Button>
          <Input
            placeholder="Add new category"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
          />
        </div>
      </div>
    </form>
  );
}
