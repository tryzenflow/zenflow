// src/components/PreferencePage.tsx
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2 } from "lucide-react";
import {
  DayEnergyBlocks,
  DaySchedulingStyle,
  defaultSchedulingStyle,
  FinalConstraintSubmission,
  dayMap,
  CategoryItem,
  defaultCategories,
  UpdateCategoryPayload,
} from "@/types/prefs"; // Assume types are in './types' or defined above

import { EnergyBlocksPrefs } from "../components/prefs/focus-blocks";
import { SchedulingStyle } from "../components/prefs/scheduling-style";
import { toast } from "sonner";
import { postData } from "../api";
import { useNavigate } from "react-router-dom";
import { CategoriesPref } from "../components/prefs/categories";
import { useUserStore } from "../hooks/use-user-store";
import { EARLY_BIRD_BLOCKS } from "@/utils/prefs";

// --- Default Data ---
const defaultEnergyBlocks: DayEnergyBlocks = {
  Mon: EARLY_BIRD_BLOCKS,
  Tue: EARLY_BIRD_BLOCKS,
  Wed: EARLY_BIRD_BLOCKS,
  Thu: EARLY_BIRD_BLOCKS,
  Fri: EARLY_BIRD_BLOCKS,
  Sat: EARLY_BIRD_BLOCKS,
  Sun: EARLY_BIRD_BLOCKS,
};

export function PrefSetupPage() {
  const user = useUserStore((state) => state.user);
  const setUser = useUserStore((state) => state.setUser);
  const userFetching = useUserStore((state) => state.loading);
  const navigate = useNavigate();
  const [categories, setCategories] =
    useState<CategoryItem[]>(defaultCategories);
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  const [focusBlocks, setEnergyBlocks] =
    useState<DayEnergyBlocks>(defaultEnergyBlocks);
  const [schedulingStyle, setSchedulingStyle] = useState<DaySchedulingStyle>(
    defaultSchedulingStyle,
  );

  const totalSteps = 3;

  useEffect(() => {
    if (userFetching === null || userFetching) return;
    if (!user) {
      navigate("/login");
      return;
    }
    if (user._count.categories > 0) {
      if (user._count.userPreferences > 0) {
        navigate("/");
      } else setCurrentStep(2);
    }
  }, [user, userFetching]);

  const handleNext = () => {
    setSubmissionError(null);
    if (currentStep < totalSteps) {
      setCurrentStep((prev) => prev + 1);
    } else {
      handleFinalSubmit(schedulingStyle);
    }
  };

  const handleBack = () => {
    setSubmissionError(null);
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const mapSchedulingStyleToDto = (
    style: DaySchedulingStyle,
    blocks: DayEnergyBlocks,
  ): FinalConstraintSubmission[] => {
    const submissionArray: FinalConstraintSubmission[] = [];
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

    days.forEach((day) => {
      const userPreferences = style[day];
      const dayBlocks = blocks[day];

      const dayNumber = dayMap[day];

      submissionArray.push({
        minGapBetweenTasks: userPreferences.minGapBetweenTasks,
        maxDailyLoad: userPreferences.maxDailyLoad,
        day: dayNumber,
        batchSimilarTasks: userPreferences.batchSimilarTasks,
        focusBlocks: dayBlocks.map((block) => ({
          level: block.level,
          start: block.start,
          end: block.end,
        })),
      });
    });
    return submissionArray;
  };

  const handleFinalSubmit = async (data: DaySchedulingStyle) => {
    setLoading(true);
    setSubmissionError(null);
    setSchedulingStyle(data); // Save the final step 3 data

    try {
      await postData("/categories/populate", { categories });
      const userPreferencePayload = mapSchedulingStyleToDto(data, focusBlocks);

      await Promise.all(
        userPreferencePayload.map((dayData) =>
          postData("/userPreferences", dayData),
        ),
      );

      setUser(
        user
          ? {
              ...user,
              _count: {
                categories: categories.length,
                userPreferences: Object.keys(dayMap).length,
              },
            }
          : null,
      );
      toast.success("Preferences saved successfully!");
      navigate("/");
    } catch (error: any) {
      setSubmissionError(
        error.message || "An unknown error occurred during submission.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleAddCategory = (newCategoryName: string) => {
    if (newCategoryName.trim()) {
      const newCategory: CategoryItem = {
        id: Date.now().toString(),
        name: newCategoryName.trim(),
        isEditable: false,
      };
      setCategories((prev) => [...prev, newCategory]);
    }
  };

  const handleEditCategoryToggle = (
    id: string,
    updatePayload: UpdateCategoryPayload,
    editing: boolean,
  ) => {
    setCategories((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, ...updatePayload, isEditable: editing } : c,
      ),
    );
  };
  const handleDeleteCategory = (id: string) => {
    setCategories((prev) => prev.filter((c) => c.id !== id));
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <CategoriesPref
            handleAdd={handleAddCategory}
            handleEdit={handleEditCategoryToggle}
            categories={categories}
            setCategories={setCategories}
            handleDelete={handleDeleteCategory}
          />
        );
      case 2:
        return (
          <EnergyBlocksPrefs
            focusBlocks={focusBlocks}
            setEnergyBlocks={setEnergyBlocks}
          />
        );
      case 3:
        return (
          <SchedulingStyle
            styleData={schedulingStyle}
            setStyleData={setSchedulingStyle}
          />
        );
      default:
        return null;
    }
  };

  if (!user && (userFetching === null || userFetching)) return null;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 md:p-12">
      <Progress value={(currentStep / totalSteps) * 100} className="mb-6 h-2" />
      <div className="bg-background rounded-lg border shadow-xl p-6 md:p-8">
        {submissionError && (
          <div className="p-3 mb-4 text-red-700 bg-red-50 border border-red-200 rounded-md">
            Submission Error: {submissionError}
          </div>
        )}
        {renderStep()}

        {/* Navigation Bar */}
        <div className="flex justify-between mt-8 pt-6 border-t">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={currentStep === 1 || loading}
          >
            Back
          </Button>
          <Button type="submit" onClick={handleNext} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : currentStep < totalSteps ? (
              "Next Step"
            ) : (
              "Finish setup"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
