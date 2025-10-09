import React, { useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Switch } from './ui';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Badge } from './ui/badge';
import { 
  Plus, 
  Trash2, 
  Edit, 
  Save,
  Shield,
  Monitor,
  Moon,
  Sun
} from 'lucide-react';

export function SettingsScreen() {
  const [categories, setCategories] = useState([
    { id: 1, name: 'Work', color: 'blue', count: 12 },
    { id: 2, name: 'Personal', color: 'green', count: 8 },
    { id: 3, name: 'Health', color: 'red', count: 5 },
    { id: 4, name: 'Learning', color: 'purple', count: 3 }
  ]);

  const [focusBlocks, setFocusBlocks] = useState([
    { id: 1, name: 'Deep Work', duration: 25, color: 'indigo' },
    { id: 2, name: 'Quick Tasks', duration: 15, color: 'green' },
    { id: 3, name: 'Break', duration: 5, color: 'orange' },
    { id: 4, name: 'Long Focus', duration: 50, color: 'blue' }
  ]);

  const [schedulingStyle, setSchedulingStyle] = useState({
    autoScheduling: true,
    breakBetweenTasks: true,
    breakDuration: 5,
    maxTasksPerDay: 10,
    workingHours: { start: '09:00', end: '17:00' },
    timezone: 'UTC+7'
  });

  const [newCategory, setNewCategory] = useState('');
  const [newFocusBlock, setNewFocusBlock] = useState({ name: '', duration: 25 });

  const addCategory = () => {
    if (newCategory.trim()) {
      const category = {
        id: Date.now(),
        name: newCategory,
        color: 'gray',
        count: 0
      };
      setCategories([...categories, category]);
      setNewCategory('');
    }
  };

  const deleteCategory = (id: number) => {
    setCategories(categories.filter(cat => cat.id !== id));
  };

  const addFocusBlock = () => {
    if (newFocusBlock.name.trim()) {
      const focusBlock = {
        id: Date.now(),
        name: newFocusBlock.name,
        duration: newFocusBlock.duration,
        color: 'gray'
      };
      setFocusBlocks([...focusBlocks, focusBlock]);
      setNewFocusBlock({ name: '', duration: 25 });
    }
  };

  const deleteFocusBlock = (id: number) => {
    setFocusBlocks(focusBlocks.filter(block => block.id !== id));
  };

  const getColorClass = (color: string) => {
    const colorMap: { [key: string]: string } = {
      blue: 'bg-blue-500',
      green: 'bg-green-500',
      red: 'bg-red-500',
      purple: 'bg-purple-500',
      orange: 'bg-orange-500',
      indigo: 'bg-indigo-500',
      gray: 'bg-gray-500'
    };
    return colorMap[color] || 'bg-gray-500';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-600 mt-1">Customize your Zenflow experience</p>
        </div>
        <div className="flex items-center space-x-3">
          <Button variant="outline" size="sm">
            <Save className="w-4 h-4 mr-2" />
            Save Changes
          </Button>
        </div>
      </div>

      <Tabs defaultValue="categories" className="w-full">
        <TabsList>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="focus-blocks">Focus Blocks</TabsTrigger>
          <TabsTrigger value="scheduling">Scheduling Style</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
        </TabsList>

        {/* Categories Settings */}
        <TabsContent value="categories" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Task Categories</CardTitle>
              <CardDescription>
                Organize your tasks with custom categories
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Add New Category */}
              <div className="flex items-center space-x-3">
                <Input
                  placeholder="Category name"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="flex-1"
                />
                <Select>
                  <SelectTrigger className="w-32">
                    <SelectValue placeholder="Color" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blue">Blue</SelectItem>
                    <SelectItem value="green">Green</SelectItem>
                    <SelectItem value="red">Red</SelectItem>
                    <SelectItem value="purple">Purple</SelectItem>
                    <SelectItem value="orange">Orange</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={addCategory}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add
                </Button>
              </div>

              {/* Categories List */}
              <div className="space-y-3">
                {categories.map((category) => (
                  <div key={category.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div className={`w-4 h-4 rounded-full ${getColorClass(category.color)}`}></div>
                      <span className="font-medium">{category.name}</span>
                      <Badge variant="secondary">{category.count} tasks</Badge>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button variant="ghost" size="sm">
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => deleteCategory(category.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Focus Blocks Settings */}
        <TabsContent value="focus-blocks" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Focus Blocks</CardTitle>
              <CardDescription>
                Configure your focus session durations
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Add New Focus Block */}
              <div className="flex items-center space-x-3">
                <Input
                  placeholder="Focus block name"
                  value={newFocusBlock.name}
                  onChange={(e) => setNewFocusBlock({ ...newFocusBlock, name: e.target.value })}
                  className="flex-1"
                />
                <Input
                  type="number"
                  placeholder="Duration"
                  value={newFocusBlock.duration}
                  onChange={(e) => setNewFocusBlock({ ...newFocusBlock, duration: parseInt(e.target.value) || 25 })}
                  className="w-24"
                />
                <span className="text-sm text-gray-600">minutes</span>
                <Button onClick={addFocusBlock}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add
                </Button>
              </div>

              {/* Focus Blocks List */}
              <div className="space-y-3">
                {focusBlocks.map((block) => (
                  <div key={block.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div className={`w-4 h-4 rounded-full ${getColorClass(block.color)}`}></div>
                      <span className="font-medium">{block.name}</span>
                      <Badge variant="outline">{block.duration} min</Badge>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button variant="ghost" size="sm">
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => deleteFocusBlock(block.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Scheduling Style Settings */}
        <TabsContent value="scheduling" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Scheduling Preferences</CardTitle>
              <CardDescription>
                Configure how tasks are scheduled and organized
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="auto-scheduling">Auto Scheduling</Label>
                    <Switch
                      id="auto-scheduling"
                      checked={schedulingStyle.autoScheduling}
                      onCheckedChange={(checked: boolean) => setSchedulingStyle({ ...schedulingStyle, autoScheduling: checked })}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="break-between-tasks">Break Between Tasks</Label>
                    <Switch
                      id="break-between-tasks"
                      checked={schedulingStyle.breakBetweenTasks}
                      onCheckedChange={(checked: boolean) => setSchedulingStyle({ ...schedulingStyle, breakBetweenTasks: checked })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="break-duration">Break Duration (minutes)</Label>
                    <Input
                      id="break-duration"
                      type="number"
                      value={schedulingStyle.breakDuration}
                      onChange={(e) => setSchedulingStyle({ ...schedulingStyle, breakDuration: parseInt(e.target.value) || 5 })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="max-tasks">Max Tasks Per Day</Label>
                    <Input
                      id="max-tasks"
                      type="number"
                      value={schedulingStyle.maxTasksPerDay}
                      onChange={(e) => setSchedulingStyle({ ...schedulingStyle, maxTasksPerDay: parseInt(e.target.value) || 10 })}
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="work-start">Working Hours Start</Label>
                    <Input
                      id="work-start"
                      type="time"
                      value={schedulingStyle.workingHours.start}
                      onChange={(e) => setSchedulingStyle({ 
                        ...schedulingStyle, 
                        workingHours: { ...schedulingStyle.workingHours, start: e.target.value }
                      })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="work-end">Working Hours End</Label>
                    <Input
                      id="work-end"
                      type="time"
                      value={schedulingStyle.workingHours.end}
                      onChange={(e) => setSchedulingStyle({ 
                        ...schedulingStyle, 
                        workingHours: { ...schedulingStyle.workingHours, end: e.target.value }
                      })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="timezone">Timezone</Label>
                    <Select value={schedulingStyle.timezone} onValueChange={(value) => setSchedulingStyle({ ...schedulingStyle, timezone: value })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="UTC+7">UTC+7 (Vietnam)</SelectItem>
                        <SelectItem value="UTC+8">UTC+8 (Singapore)</SelectItem>
                        <SelectItem value="UTC+9">UTC+9 (Japan)</SelectItem>
                        <SelectItem value="UTC-5">UTC-5 (EST)</SelectItem>
                        <SelectItem value="UTC-8">UTC-8 (PST)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Appearance Settings */}
        <TabsContent value="appearance" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>
                Customize the look and feel of your interface
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Theme</Label>
                    <div className="flex items-center space-x-4">
                      <Button variant="outline" size="sm">
                        <Sun className="w-4 h-4 mr-2" />
                        Light
                      </Button>
                      <Button variant="outline" size="sm">
                        <Moon className="w-4 h-4 mr-2" />
                        Dark
                      </Button>
                      <Button variant="outline" size="sm">
                        <Monitor className="w-4 h-4 mr-2" />
                        System
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Accent Color</Label>
                    <div className="flex items-center space-x-2">
                      <div className="w-8 h-8 bg-blue-500 rounded-full cursor-pointer border-2 border-blue-600"></div>
                      <div className="w-8 h-8 bg-green-500 rounded-full cursor-pointer border-2 border-transparent"></div>
                      <div className="w-8 h-8 bg-purple-500 rounded-full cursor-pointer border-2 border-transparent"></div>
                      <div className="w-8 h-8 bg-orange-500 rounded-full cursor-pointer border-2 border-transparent"></div>
                      <div className="w-8 h-8 bg-red-500 rounded-full cursor-pointer border-2 border-transparent"></div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Font Size</Label>
                    <Select defaultValue="medium">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="small">Small</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="large">Large</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Density</Label>
                    <Select defaultValue="comfortable">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="compact">Compact</SelectItem>
                        <SelectItem value="comfortable">Comfortable</SelectItem>
                        <SelectItem value="spacious">Spacious</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications Settings */}
        <TabsContent value="notifications" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Notifications</CardTitle>
              <CardDescription>
                Manage your notification preferences
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="task-reminders">Task Reminders</Label>
                    <p className="text-sm text-gray-600">Get notified about upcoming tasks</p>
                  </div>
                  <Switch id="task-reminders" />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="focus-sessions">Focus Session Alerts</Label>
                    <p className="text-sm text-gray-600">Notifications for focus session start/end</p>
                  </div>
                  <Switch id="focus-sessions" />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="daily-summary">Daily Summary</Label>
                    <p className="text-sm text-gray-600">Receive daily productivity summary</p>
                  </div>
                  <Switch id="daily-summary" />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="email-notifications">Email Notifications</Label>
                    <p className="text-sm text-gray-600">Receive notifications via email</p>
                  </div>
                  <Switch id="email-notifications" />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Account Settings */}
        <TabsContent value="account" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Account Settings</CardTitle>
              <CardDescription>
                Manage your account information and security
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="display-name">Display Name</Label>
                    <Input id="display-name" placeholder="Your display name" />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <Input id="email" type="email" placeholder="your@email.com" />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="timezone">Timezone</Label>
                    <Select defaultValue="UTC+7">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="UTC+7">UTC+7 (Vietnam)</SelectItem>
                        <SelectItem value="UTC+8">UTC+8 (Singapore)</SelectItem>
                        <SelectItem value="UTC+9">UTC+9 (Japan)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="current-password">Current Password</Label>
                    <Input id="current-password" type="password" />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="new-password">New Password</Label>
                    <Input id="new-password" type="password" />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">Confirm Password</Label>
                    <Input id="confirm-password" type="password" />
                  </div>

                  <Button variant="outline" className="w-full">
                    <Shield className="w-4 h-4 mr-2" />
                    Change Password
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
