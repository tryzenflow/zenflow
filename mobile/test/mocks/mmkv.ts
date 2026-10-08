export const createMMKV = () => {
  const m = new Map<string, string>();
  return {
    getString: (k: string) => m.get(k),
    set: (k: string, v: string) => void m.set(k, v),
    remove: (k: string) => m.delete(k),
    delete: (k: string) => m.delete(k),
    contains: (k: string) => m.has(k),
    getAllKeys: () => [...m.keys()],
    clearAll: () => m.clear(),
  };
};
