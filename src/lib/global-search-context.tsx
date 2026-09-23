import { createContext, useContext } from "react";

// Lets any component (e.g. the sidebar Search button) open the global search
// palette that is mounted once at the authenticated-layout level.
export const GlobalSearchContext = createContext<{ open: () => void }>({ open: () => {} });

export function useGlobalSearch() {
  return useContext(GlobalSearchContext);
}
