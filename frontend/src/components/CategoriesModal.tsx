import React, { useState } from 'react';
import { X, Plus, GripVertical } from 'lucide-react';
import { Button } from './ui/button';

interface CategoriesModalProps {
  onClose: () => void;
}

const defaultCategories = [
  { id: '1', emoji: '🎓', name: 'Work / School' },
  { id: '2', emoji: '🏠', name: 'Personal / Home' },
  { id: '3', emoji: '💪', name: 'Health & Fitness' },
  { id: '4', emoji: '👨‍👩‍👧', name: 'Family & Friends' },
  { id: '5', emoji: '✅', name: 'Chores / Household' },
  { id: '6', emoji: '📚', name: 'Learning / Growth' },
  { id: '7', emoji: '⭐', name: 'Priorities / Goals' },
];

export function CategoriesModal({ onClose }: CategoriesModalProps) {
  const [categories, setCategories] = useState(defaultCategories);

  const removeCategory = (id: string) => {
    setCategories(categories.filter(cat => cat.id !== id));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-md rounded-[20px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.3)]">
        <div className="space-y-6 px-8 py-8">
          <div className="text-center">
            <h2 className="text-xl font-semibold text-gray-900">Customize categories</h2>
            <p className="mt-1 text-sm text-gray-500">Add, edit or delete categories</p>
          </div>

          <div className="space-y-2">
            {categories.map((category) => (
              <div
                key={category.id}
                className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 transition hover:border-gray-300"
              >
                <button className="cursor-grab text-gray-400 hover:text-gray-600">
                  <GripVertical className="h-4 w-4" />
                </button>
                <span className="text-lg">{category.emoji}</span>
                <span className="flex-1 text-sm text-gray-900">{category.name}</span>
                <button
                  onClick={() => removeCategory(category.id)}
                  className="text-gray-400 transition hover:text-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}

            <button className="flex w-full items-center gap-3 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-600 transition hover:border-gray-400 hover:bg-gray-100">
              <Plus className="h-4 w-4" />
              Add new category
            </button>
          </div>

          <Button
            className="w-full rounded-lg bg-black py-2.5 text-sm font-medium text-white hover:bg-black/90"
            onClick={onClose}
          >
            I'm fine with this
          </Button>
        </div>
      </div>
    </div>
  );
}

