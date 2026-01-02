export const DAILY_HORIZON = 1440; // Minutes in a day (from 0 to 1440)

// Data structure for an individual Category (Step 1)
export interface CategoryItem {
  id: string; // Used for local key and DnD
  name: string;
  isEditable: boolean; // Local UI state
}

// Data structure for an individual Focus Block (Step 2)
export interface EnergyBlock {
  id: string; // Local key
  level: 1 | 2 | 3; // 1: Low, 2: Medium, 3: High
  start: number; // Minutes from midnight (e.g., 5:00 AM = 300)
  end: number; // Minutes from midnight
}

// Data structure for daily Focus Blocks (Step 2 state)
export type DayEnergyBlocks = {
  [key in "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"]: EnergyBlock[];
};

// Data structure for daily Scheduling Style (Step 3 state)
export interface DailyUserPreferences {
  minGapBetweenTasks: number; // Minimum Break Time (in minutes)
  maxDailyLoad: number; // Maximum Daily Load (in minutes, 8 hours 30 mins = 510)
  batchSimilarTasks: boolean;
}

export interface UserPreferences extends DailyUserPreferences {
  id: string;
  day: number; // 0=Sun, 1=Mon, ..., 6=Sat
  focusBlocks: EnergyBlock[];
}

export type DaySchedulingStyle = {
  [key in
    | "Mon"
    | "Tue"
    | "Wed"
    | "Thu"
    | "Fri"
    | "Sat"
    | "Sun"]: DailyUserPreferences;
};

export interface UpdateCategoryPayload {
  beforeId?: string;
  afterId?: string;
  name: string;
}

export interface NewCategoryPayload {
  name: string;
}

export interface FinalConstraintSubmission {
  minGapBetweenTasks: number;
  maxDailyLoad: number;
  day: number; // 0=Sun, 1=Mon, ..., 6=Sat (We'll map Mon-Sun to 1-7, then adjust)
  batchSimilarTasks: boolean;
  focusBlocks: { level: number; start: number; end: number }[];
}

export const dayMap: {
  [key in "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"]: number;
} = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export const defaultUserPreferences: DailyUserPreferences = {
  minGapBetweenTasks: 20, // 20 minutes
  maxDailyLoad: 510, // 8 hours 30 minutes
  batchSimilarTasks: true,
};

export const defaultCategories: CategoryItem[] = [
  { id: "1", name: "💼 Work / School", isEditable: false },
  { id: "2", name: "🏠 Personal / Home", isEditable: false },
  { id: "3", name: "🏋️ Health & Fitness", isEditable: false },
  { id: "4", name: "👨‍👩‍👧‍👦 Family & Friends", isEditable: false },
  { id: "5", name: "🧹 Chores / Household", isEditable: false },
  { id: "6", name: "📚 Learning / Growth", isEditable: false },
  { id: "7", name: "⭐️ Priorities / Goals", isEditable: false },
];

export const defaultSchedulingStyle: DaySchedulingStyle = {
  Mon: { ...defaultUserPreferences },
  Tue: { ...defaultUserPreferences },
  Wed: { ...defaultUserPreferences },
  Thu: { ...defaultUserPreferences },
  Fri: { ...defaultUserPreferences },
  Sat: { minGapBetweenTasks: 30, maxDailyLoad: 360, batchSimilarTasks: false }, // 6 hours
  Sun: { minGapBetweenTasks: 30, maxDailyLoad: 360, batchSimilarTasks: false },
};
