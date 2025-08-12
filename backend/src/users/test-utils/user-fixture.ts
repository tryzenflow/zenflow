import { faker } from "@faker-js/faker";
import { User } from "../../../generated/prisma";

export const userFixture = (attrs?: Partial<User>): User => {
  return {
    id: 1,
    email: faker.internet.email(),
    name: faker.person.fullName(),
    maxDeepWorkHours: 4,
    batchSimilarTasks: true,
    createdAt: new Date(),
    minBreakMinutesBetweenTasks: 10,
    timezone: "Asia/Tokyo",
    ...attrs,
  };
};
