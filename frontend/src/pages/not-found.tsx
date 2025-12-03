import { CircleQuestionMarkIcon, HomeIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <Empty className="from-muted/50 to-background h-screen bg-gradient-to-b from-30%">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleQuestionMarkIcon />
        </EmptyMedia>
        <EmptyTitle>404 Page Not Found</EmptyTitle>
        <EmptyDescription>
          The page you are looking for does not exist.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline" size="sm">
          <Link to="/">
            <HomeIcon />
            Back to Home
          </Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}
