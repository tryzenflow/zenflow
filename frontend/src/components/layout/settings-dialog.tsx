import { useState } from "react";
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { patchData } from "@/api";
import { toast } from "sonner";
import { CategoriesPref } from "@/components/prefs/categories";
import { FocusBlocksPrefs } from "@/components/prefs/focus-blocks";
import { SchedulingStyle } from "@/components/prefs/scheduling-style";
import { CategoryItem } from "@/types/prefs";
import { DayFocusBlocks, DaySchedulingStyle } from "@/types/prefs";

const accountSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email address"),
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

  // Account form
  const accountForm = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      name: user?.name || "",
      email: user?.email || "",
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
  const [schedulingStyle, setSchedulingStyle] = useState<DaySchedulingStyle>({
    Mon: { batchSimilarTasks: false, maxDailyLoad: 480, minGapBetweenTasks: 0 },
    Tue: { batchSimilarTasks: false, maxDailyLoad: 480, minGapBetweenTasks: 0 },
    Wed: { batchSimilarTasks: false, maxDailyLoad: 480, minGapBetweenTasks: 0 },
    Thu: { batchSimilarTasks: false, maxDailyLoad: 480, minGapBetweenTasks: 0 },
    Fri: { batchSimilarTasks: false, maxDailyLoad: 480, minGapBetweenTasks: 0 },
    Sat: { batchSimilarTasks: false, maxDailyLoad: 480, minGapBetweenTasks: 0 },
    Sun: { batchSimilarTasks: false, maxDailyLoad: 480, minGapBetweenTasks: 0 },
  });

  const onAccountSubmit = async (data: AccountFormValues) => {
    setIsLoading(true);
    try {
      await patchData("/users/update/basic-info", {
        name: data.name,
      });
      setUser({
        ...user!,
        name: data.name,
      });
      toast.success("Account information updated successfully");
    } catch (error) {
      toast.error("Failed to update account information");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSavePreferences = async () => {
    setIsLoading(true);
    try {
      // In a real implementation, you would send these to the backend
      toast.success("Preferences saved successfully");
      onOpenChange(false);
    } catch (error) {
      toast.error("Failed to save preferences");
    } finally {
      setIsLoading(false);
    }
  };

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Settings
          </DialogTitle>
          <DialogDescription>
            Manage your account and preferences
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="account" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="preferences">Preferences</TabsTrigger>
            <TabsTrigger value="scheduling">Scheduling</TabsTrigger>
          </TabsList>

          {/* Account Tab */}
          <TabsContent value="account" className="space-y-4">
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
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Enter your email"
                          disabled
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Email cannot be changed
                      </FormDescription>
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

          {/* Preferences Tab */}
          <TabsContent value="preferences" className="space-y-4">
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-4">Categories</h3>
                <CategoriesPref
                  categories={categories}
                  setCategories={setCategories}
                />
              </div>
            </div>
          </TabsContent>

          {/* Scheduling Tab */}
          <TabsContent value="scheduling" className="space-y-4">
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-4">Focus Blocks</h3>
                <FocusBlocksPrefs
                  focusBlocks={focusBlocks}
                  setFocusBlocks={setFocusBlocks}
                />
              </div>

              <div className="mt-6 pt-6 border-t">
                <h3 className="text-lg font-semibold mb-4">Scheduling Style</h3>
                <SchedulingStyle
                  initialSchedulingStyle={schedulingStyle}
                  onNext={setSchedulingStyle}
                  onBack={() => {}}
                />
              </div>
            </div>

            <Button onClick={handleSavePreferences} disabled={isLoading}>
              Save Preferences
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
