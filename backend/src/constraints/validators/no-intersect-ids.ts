import { BadRequestException } from "@nestjs/common";

export const validateNoIntersectIds = (
  updateIds?: string[],
  deleteIds?: string[]
) => {
  const updateIdsSet = new Set(updateIds ?? []);
  const deleteIdsSet = new Set(deleteIds ?? []);

  for (const key in updateIdsSet) {
    if (updateIdsSet.has(key))
      throw new BadRequestException(
        `Found duplicate ID ${key} in both update and delete`
      );
  }

  for (const key in updateIdsSet) {
    if (deleteIdsSet.has(key))
      throw new BadRequestException(
        `Found duplicate ID ${key} in both update and delete`
      );
  }
};
