export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  timezone: string;
  _count: {
    userPreferences: number;
    categories: number;
  };
}
