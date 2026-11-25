// Which overlays are open (tour, situation picker). Not saved: a reload starts with them closed.
import { create } from "zustand";

export const useUi = create<{ tour: boolean; situations: boolean; set: (p: Partial<{ tour: boolean; situations: boolean }>) => void }>((set) => ({
  tour: false,
  situations: false,
  set: (p) => set(p),
}));
