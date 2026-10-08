// className styling is irrelevant to behaviour tests; keep the API surface.
export const cssInterop = <T,>(component: T) => component;
export const remapProps = <T,>(component: T) => component;
export const useColorScheme = () => ({
  colorScheme: "light" as const,
  setColorScheme: () => {},
  toggleColorScheme: () => {},
});
export const vars = (v: unknown) => v;
