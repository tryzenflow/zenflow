// src/components/PreferencePage.tsx
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2 } from "lucide-react";
import {
  DayFocusBlocks,
  DaySchedulingStyle,
  defaultSchedulingStyle,
  FinalConstraintSubmission,
  dayMap,
  CategoryItem,
  defaultCategories,
} from "@/types/prefs"; // Assume types are in './types' or defined above

import { FocusBlocksPrefs } from "../components/prefs/focus-blocks";
import { SchedulingStyle } from "../components/prefs/scheduling-style";
import { toast } from "sonner";
import { postData } from "../api";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CategoriesPref } from "../components/prefs/categories";
import { useUserStore } from "../hooks/use-user-store";

// --- Default Data ---
const defaultFocusBlocks: DayFocusBlocks = {
  Mon: [],
  Tue: [],
  Wed: [],
  Thu: [],
  Fri: [],
  Sat: [],
  Sun: [],
};

export function PrefSetupPage() {
  const user = useUserStore((state) => state.user);
  const navigate = useNavigate();
  const [categories, setCategories] =
    useState<CategoryItem[]>(defaultCategories);
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  const [focusBlocks, setFocusBlocks] =
    useState<DayFocusBlocks>(defaultFocusBlocks);
  const [schedulingStyle, setSchedulingStyle] = useState<DaySchedulingStyle>(
    defaultSchedulingStyle
  );
  const [searchParams] = useSearchParams();

  const totalSteps = 3;

  useEffect(() => {
    if (!user) return;
    if (user._count.categories > 0) setCurrentStep(2);
    if (user._count.constraints > 0) {
      navigate(searchParams.get("callback") ?? "/");
    }
  }, [user]);

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
    blocks: DayFocusBlocks
  ): FinalConstraintSubmission[] => {
    const submissionArray: FinalConstraintSubmission[] = [];
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

    days.forEach((day) => {
      const constraints = style[day];
      const dayBlocks = blocks[day];

      const weekdayNumber = dayMap[day];

      submissionArray.push({
        minGapBetweenTasks: constraints.minGapBetweenTasks,
        maxDailyLoad: constraints.maxDailyLoad,
        weekday: weekdayNumber,
        batchSimilarTasks: constraints.batchSimilarTasks,
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
      const constraintPayload = mapSchedulingStyleToDto(data, focusBlocks);

      await Promise.all(
        constraintPayload.map((dayData) => postData("/constraints", dayData))
      );

      toast.success("Preferences saved successfully!");
      navigate("/");
    } catch (error: any) {
      setSubmissionError(
        error.message || "An unknown error occurred during submission."
      );
    } finally {
      setLoading(false);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <CategoriesPref
            categories={categories}
            setCategories={setCategories}
          />
        );
      case 2:
        return (
          <FocusBlocksPrefs
            focusBlocks={focusBlocks}
            setFocusBlocks={setFocusBlocks}
          />
        );
      case 3:
        return (
          <SchedulingStyle
            initialSchedulingStyle={schedulingStyle}
            onNext={handleFinalSubmit}
            onBack={handleBack}
          />
        );
      default:
        return null;
    }
  };

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
