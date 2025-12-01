import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings } from "lucide-react";
import { useUserStore } from "@/hooks/use-user-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { deleteData, getData, patchData, postData } from "@/api";
import { toast } from "sonner";
import { CategoriesPref } from "@/components/prefs/categories";
import { FocusBlocksPrefs } from "@/components/prefs/focus-blocks";
import { SchedulingStyle } from "@/components/prefs/scheduling-style";
import {
  CategoryItem,
  Constraints,
  defaultSchedulingStyle,
  UpdateCategoryPayload,
} from "@/types/prefs";
import { DayFocusBlocks, DaySchedulingStyle } from "@/types/prefs";
import { TimezoneSelect } from "../settings/timezone-select";

const accountSchema = z.object({
  name: z.string().min(1, "Name is required"),
  timezone: z.string().min(1, "Timezone is required"),
});

type AccountFormValues = z.infer<typeof accountSchema>;

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const user = useUserStore((state) => state.user);
  const setUser = useUserStore((state) => state.setUser);
  const [isLoading, setIsLoading] = useState(false);
  const [styleData, setStyleData] = useState<DaySchedulingStyle>(
    defaultSchedulingStyle,
  );

  // Account form
  const accountForm = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      name: user?.name || "",
      timezone: user?.timezone || "",
    },
  });

  // Preferences state
  const [categories, setCategories] = useState<CategoryItem[]>([]);

  const [focusBlocks, setFocusBlocks] = useState<DayFocusBlocks>({
    Mon: [],
    Tue: [],
    Wed: [],
    Thu: [],
    Fri: [],
    Sat: [],
    Sun: [],
  });

  const onAccountSubmit = async (data: AccountFormValues) => {
    setIsLoading(true);
    try {
      await patchData("/users/update/basic-info", {
        name: data.name,
        timezone: data.timezone,
      });
      setUser({
        ...user!,
        name: data.name,
        timezone: data.timezone,
      });
      toast.success("Account information updated successfully");
    } catch (error) {
      toast.error("Failed to update account information");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setIsLoading(true);
    getData<{ data: CategoryItem[] }>("/categories")
      .then((data) => {
        setCategories(data.data);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    setIsLoading(true);
    getData<{ data: Constraints[] }>("/constraints")
      .then((data) => {
        const constraints = data.data;
        setStyleData(() =>
          data.data.reduce((acc, constraint) => {
            const weekdayMap: { [key: number]: keyof DaySchedulingStyle } = {
              0: "Sun",
              1: "Mon",
              2: "Tue",
              3: "Wed",
              4: "Thu",
              5: "Fri",
              6: "Sat",
            };
            const dayKey = weekdayMap[constraint.weekday];
            acc[dayKey] = {
              batchSimilarTasks: constraint.batchSimilarTasks,
              maxDailyLoad: constraint.maxDailyLoad,
              minGapBetweenTasks: constraint.minGapBetweenTasks,
            };
            return acc;
          }, {} as DaySchedulingStyle),
        );

        setFocusBlocks(() => {
          return constraints.reduce((acc, constraint) => {
            const weekdayMap: { [key: number]: keyof DayFocusBlocks } = {
              0: "Sun",
              1: "Mon",
              2: "Tue",
              3: "Wed",
              4: "Thu",
              5: "Fri",
              6: "Sat",
            };
            const dayKey = weekdayMap[constraint.weekday];
            acc[dayKey] = constraint.focusBlocks.map((block) => ({
              id: block.id,
              start: block.start,
              end: block.end,
              level: block.level,
            }));
            return acc;
          }, {} as DayFocusBlocks);
        });
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const handleAddCategory = async (name: string) => {
    try {
      setIsLoading(true);
      const { data } = await postData<object, { data: CategoryItem }>(
        "/categories",
        { name },
      );
      const newCategory: CategoryItem = {
        id: data.id,
        name,
        isEditable: false,
      };
      setCategories((prev) => [...prev, newCategory]);
    } catch (error) {
      console.log(error);
      toast.error("Failed to add category");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditCategory = async (
    id: string,
    updatePayload: UpdateCategoryPayload,
    editing: boolean,
  ) => {
    try {
      setIsLoading(true);
      const categoryIndex = categories.findIndex((c) => c.id === id);

      if (categoryIndex === -1) return;
      await patchData(`/categories/${id}`, updatePayload);
      setCategories((prev) =>
        prev.map((c) => (c.id === id ? { ...c, isEditable: editing } : c)),
      );
    } catch (error) {
      console.log(error);
      toast.error("Failed to edit category");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    try {
      setIsLoading(true);
      await deleteData(`/categories/${id}`);
      setCategories((prev) => prev.filter((c) => c.id !== id));
      toast.success("Category deleted successfully");
    } catch (error) {
      console.log(error);

      toast.error("Failed to delete category");
    } finally {
      setIsLoading(false);
    }
  };

  const updateFocusBlocks = async (weekday: keyof DayFocusBlocks) => {
    try {
      setIsLoading(true);
      const weekdayIndex = (
        ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const
      ).indexOf(weekday);
      if (weekdayIndex === -1) return;
      await patchData(`/constraints/${weekdayIndex}`, {
        focusBlocks: focusBlocks[weekday],
      });
      setFocusBlocks((prev) => ({
        ...prev,
        [weekdayIndex]: focusBlocks[weekday],
      }));
    } catch (error) {
      console.log(error);
      toast.error("Failed to update focus blocks");
    } finally {
      setIsLoading(false);
    }
  };

  const updateSchedulingStyle = async (weekday: keyof DaySchedulingStyle) => {
    try {
      setIsLoading(true);
      const weekdayIndex = (
        ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const
      ).indexOf(weekday);
      if (weekdayIndex === -1) return;
      await patchData(`/constraints/${weekdayIndex}`, styleData[weekday]);
    } catch (error) {
      console.log(error);
      toast.error("Failed to update scheduling style");
    } finally {
      setIsLoading(false);
    }
  };

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl flex flex-col sm:max-w-2xl h-[90vh] max-h-[90vh] overflow-y-auto">
        <DialogHeader className="h-fit">
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Settings
          </DialogTitle>
          <DialogDescription>
            Manage your account and preferences
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="account" className="w-full h-full flex-1">
          <TabsList className="w-full">
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="categories">Categories</TabsTrigger>
            <TabsTrigger value="focus-blocks">Focus Blocks</TabsTrigger>
            <TabsTrigger value="scheduling">Scheduling</TabsTrigger>
          </TabsList>

          {/* Account Tab */}
          <TabsContent value="account" className="my-4">
            <Form {...accountForm}>
              <form
                onSubmit={accountForm.handleSubmit(onAccountSubmit)}
                className="space-y-4"
              >
                <FormField
                  control={accountForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter your full name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={accountForm.control}
                  name="timezone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Timezone</FormLabel>
                      <FormControl>
                        {/* list of timezones */}
                        <TimezoneSelect
                          timezone={field.value}
                          setTimezone={field.onChange}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button type="submit" disabled={isLoading}>
                  Save Changes
                </Button>
              </form>
            </Form>
          </TabsContent>

          {/* Categories Tab */}
          <TabsContent value="categories" className="my-4">
            <CategoriesPref
              categories={categories}
              setCategories={setCategories}
              handleAdd={handleAddCategory}
              handleEdit={handleEditCategory}
              handleDelete={handleDeleteCategory}
            />
          </TabsContent>
          <TabsContent value="focus-blocks" className="my-4 pb-4">
            <div className="space-y-4">
              <FocusBlocksPrefs
                focusBlocks={focusBlocks}
                setFocusBlocks={setFocusBlocks}
              />
              <Button
                disabled={isLoading}
                onClick={async () => {
                  await Promise.all(
                    Object.keys(focusBlocks).map((day) =>
                      updateFocusBlocks(day as keyof DayFocusBlocks),
                    ),
                  );
                  toast.success("Focus blocks updated successfully");
                }}
              >
                Save Changes
              </Button>
            </div>
          </TabsContent>

          {/* Scheduling Tab */}
          <TabsContent value="scheduling" className="my-4 pb-4">
            <div className="space-y-4">
              <SchedulingStyle
                styleData={styleData}
                setStyleData={setStyleData}
              />
              <Button
                disabled={isLoading}
                onClick={async () => {
                  await Promise.all(
                    Object.keys(styleData).map((day) =>
                      updateSchedulingStyle(day as keyof DaySchedulingStyle),
                    ),
                  );
                  toast.success("Scheduling style updated successfully");
                }}
              >
                Save Changes
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
