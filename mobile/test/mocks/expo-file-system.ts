/** Native file system stand-in: nothing in the tested screens reads or writes real files. */
export class Directory {
  exists = false;
  constructor(..._parts: unknown[]) {}
  create() {}
}
export class File {
  exists = false;
  uri = "file:///stub";
  constructor(..._parts: unknown[]) {}
  static downloadFileAsync = async () => new File();
  delete() {}
}
export const Paths = { cache: "file:///cache", document: "file:///documents" };
