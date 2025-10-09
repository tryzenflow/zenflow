import React, { useState } from 'react';
import {
  Button,
  Input,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Badge,
  Textarea,
  Label,
  Checkbox,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  Alert,
  AlertDescription,
  AlertTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Progress,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarItem,
} from './ui';
import { CheckCircle, AlertCircle, Info, XCircle } from 'lucide-react';

export function ZenflowDemo() {
  const [progress, setProgress] = useState(33);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900">Zenflow UI Components</h1>
          <p className="text-gray-600 mt-2">A comprehensive React component library inspired by Zenflow design system</p>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Sidebar */}
          <div className="lg:col-span-1">
            <Sidebar>
              <SidebarHeader>
                <h2 className="text-lg font-semibold">Components</h2>
              </SidebarHeader>
              <SidebarContent>
                <SidebarGroup title="Basic">
                  <SidebarItem>Button</SidebarItem>
                  <SidebarItem>Input</SidebarItem>
                  <SidebarItem>Card</SidebarItem>
                  <SidebarItem>Badge</SidebarItem>
                </SidebarGroup>
                <SidebarGroup title="Form">
                  <SidebarItem>Checkbox</SidebarItem>
                  <SidebarItem>Radio</SidebarItem>
                  <SidebarItem>Select</SidebarItem>
                  <SidebarItem>Textarea</SidebarItem>
                </SidebarGroup>
                <SidebarGroup title="Layout">
                  <SidebarItem>Tabs</SidebarItem>
                  <SidebarItem>Accordion</SidebarItem>
                </SidebarGroup>
                <SidebarGroup title="Data">
                  <SidebarItem>Table</SidebarItem>
                  <SidebarItem>Pagination</SidebarItem>
                </SidebarGroup>
                <SidebarGroup title="Feedback">
                  <SidebarItem>Alert</SidebarItem>
                  <SidebarItem>Dialog</SidebarItem>
                  <SidebarItem>Progress</SidebarItem>
                </SidebarGroup>
              </SidebarContent>
              <SidebarFooter>
                <p className="text-xs text-gray-500">Zenflow UI v1.0.0</p>
              </SidebarFooter>
            </Sidebar>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3 space-y-8">
            {/* Buttons */}
            <section>
              <h2 className="text-2xl font-semibold mb-4">Buttons</h2>
              <div className="space-y-4">
                <div className="flex flex-wrap gap-4">
                  <Button>Default</Button>
                  <Button variant="secondary">Secondary</Button>
                  <Button variant="destructive">Destructive</Button>
                  <Button variant="outline">Outline</Button>
                  <Button variant="ghost">Ghost</Button>
                  <Button variant="link">Link</Button>
                </div>
                <div className="flex flex-wrap gap-4">
                  <Button size="sm">Small</Button>
                  <Button size="default">Default</Button>
                  <Button size="lg">Large</Button>
                  <Button size="icon">🚀</Button>
                </div>
              </div>
            </section>

            {/* Form Components */}
            <section>
              <h2 className="text-2xl font-semibold mb-4">Form Components</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Input Fields</CardTitle>
                    <CardDescription>Various input field examples</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label htmlFor="email">Email</Label>
                      <Input id="email" type="email" placeholder="Enter your email" />
                    </div>
                    <div>
                      <Label htmlFor="password">Password</Label>
                      <Input id="password" type="password" placeholder="Enter your password" />
                    </div>
                    <div>
                      <Label htmlFor="message">Message</Label>
                      <Textarea id="message" placeholder="Enter your message" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Selection Controls</CardTitle>
                    <CardDescription>Checkboxes, radios, and selects</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center space-x-2">
                      <Checkbox id="terms" />
                      <Label htmlFor="terms">Accept terms and conditions</Label>
                    </div>
                    
                    <div>
                      <Label>Choose an option</Label>
                      <RadioGroup defaultValue="option1" className="mt-2">
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="option1" id="r1" />
                          <Label htmlFor="r1">Option 1</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="option2" id="r2" />
                          <Label htmlFor="r2">Option 2</Label>
                        </div>
                      </RadioGroup>
                    </div>

                    <div>
                      <Label>Select a fruit</Label>
                      <Select>
                        <SelectTrigger className="mt-2">
                          <SelectValue placeholder="Select a fruit" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="apple">Apple</SelectItem>
                          <SelectItem value="banana">Banana</SelectItem>
                          <SelectItem value="orange">Orange</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </section>

            {/* Cards and Badges */}
            <section>
              <h2 className="text-2xl font-semibold mb-4">Cards & Badges</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Card Title</CardTitle>
                    <CardDescription>Card description goes here</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-gray-600">
                      This is the card content. It can contain any type of content.
                    </p>
                  </CardContent>
                  <CardFooter>
                    <Button className="w-full">Action</Button>
                  </CardFooter>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>With Badges</CardTitle>
                    <CardDescription>Cards with badge components</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <Badge>Default</Badge>
                      <Badge variant="secondary">Secondary</Badge>
                      <Badge variant="destructive">Destructive</Badge>
                      <Badge variant="outline">Outline</Badge>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Status Card</CardTitle>
                    <CardDescription>Card with status indicators</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center space-x-2">
                      <CheckCircle className="h-5 w-5 text-green-500" />
                      <span className="text-sm">All systems operational</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </section>

            {/* Tabs */}
            <section>
              <h2 className="text-2xl font-semibold mb-4">Tabs</h2>
              <Tabs defaultValue="account" className="w-full">
                <TabsList>
                  <TabsTrigger value="account">Account</TabsTrigger>
                  <TabsTrigger value="password">Password</TabsTrigger>
                  <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>
                <TabsContent value="account" className="mt-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Account Information</CardTitle>
                      <CardDescription>Manage your account settings</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <Label htmlFor="name">Name</Label>
                        <Input id="name" placeholder="Your name" />
                      </div>
                      <div>
                        <Label htmlFor="email-tab">Email</Label>
                        <Input id="email-tab" type="email" placeholder="your@email.com" />
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
                <TabsContent value="password" className="mt-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Change Password</CardTitle>
                      <CardDescription>Update your password</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <Label htmlFor="current-password">Current Password</Label>
                        <Input id="current-password" type="password" />
                      </div>
                      <div>
                        <Label htmlFor="new-password">New Password</Label>
                        <Input id="new-password" type="password" />
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
                <TabsContent value="settings" className="mt-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Settings</CardTitle>
                      <CardDescription>Configure your preferences</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-gray-600">Settings content goes here.</p>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </section>

            {/* Accordion */}
            <section>
              <h2 className="text-2xl font-semibold mb-4">Accordion</h2>
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="item-1">
                  <AccordionTrigger>Is it accessible?</AccordionTrigger>
                  <AccordionContent>
                    Yes. It adheres to the WAI-ARIA design pattern and is built with accessibility in mind.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-2">
                  <AccordionTrigger>Is it styled?</AccordionTrigger>
                  <AccordionContent>
                    Yes. It comes with default styles that matches the other components aesthetic.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-3">
                  <AccordionTrigger>Is it animated?</AccordionTrigger>
                  <AccordionContent>
                    Yes. It's animated by default, but you can disable it if you prefer.
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </section>

            {/* Table */}
            <section>
              <h2 className="text-2xl font-semibold mb-4">Data Table</h2>
              <Card>
                <CardHeader>
                  <CardTitle>Recent Orders</CardTitle>
                  <CardDescription>A list of your recent orders</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Order ID</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell>#12345</TableCell>
                        <TableCell>John Doe</TableCell>
                        <TableCell>
                          <Badge variant="secondary">Processing</Badge>
                        </TableCell>
                        <TableCell>$99.00</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>#12346</TableCell>
                        <TableCell>Jane Smith</TableCell>
                        <TableCell>
                          <Badge>Completed</Badge>
                        </TableCell>
                        <TableCell>$149.00</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>#12347</TableCell>
                        <TableCell>Bob Johnson</TableCell>
                        <TableCell>
                          <Badge variant="destructive">Cancelled</Badge>
                        </TableCell>
                        <TableCell>$79.00</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
                <CardFooter>
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious href="#" />
                      </PaginationItem>
                      <PaginationItem>
                        <PaginationLink href="#">1</PaginationLink>
                      </PaginationItem>
                      <PaginationItem>
                        <PaginationLink href="#" isActive>2</PaginationLink>
                      </PaginationItem>
                      <PaginationItem>
                        <PaginationLink href="#">3</PaginationLink>
                      </PaginationItem>
                      <PaginationItem>
                        <PaginationNext href="#" />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </CardFooter>
              </Card>
            </section>

            {/* Alerts */}
            <section>
              <h2 className="text-2xl font-semibold mb-4">Alerts</h2>
              <div className="space-y-4">
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>Information</AlertTitle>
                  <AlertDescription>
                    This is an informational alert message.
                  </AlertDescription>
                </Alert>

                <Alert variant="success">
                  <CheckCircle className="h-4 w-4" />
                  <AlertTitle>Success</AlertTitle>
                  <AlertDescription>
                    Your action was completed successfully.
                  </AlertDescription>
                </Alert>

                <Alert variant="warning">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Warning</AlertTitle>
                  <AlertDescription>
                    Please review your input before proceeding.
                  </AlertDescription>
                </Alert>

                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>
                    Something went wrong. Please try again.
                  </AlertDescription>
                </Alert>
              </div>
            </section>

            {/* Progress */}
            <section>
              <h2 className="text-2xl font-semibold mb-4">Progress</h2>
              <Card>
                <CardHeader>
                  <CardTitle>Progress Examples</CardTitle>
                  <CardDescription>Different progress bar examples</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label>Progress: {progress}%</Label>
                    <Progress value={progress} className="mt-2" />
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      size="sm" 
                      onClick={() => setProgress(Math.max(0, progress - 10))}
                    >
                      Decrease
                    </Button>
                    <Button 
                      size="sm" 
                      onClick={() => setProgress(Math.min(100, progress + 10))}
                    >
                      Increase
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </section>

            {/* Dialog */}
            <section>
              <h2 className="text-2xl font-semibold mb-4">Dialog</h2>
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button>Open Dialog</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Are you sure?</DialogTitle>
                    <DialogDescription>
                      This action cannot be undone. This will permanently delete your account
                      and remove your data from our servers.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button variant="destructive" onClick={() => setIsDialogOpen(false)}>
                      Delete
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
