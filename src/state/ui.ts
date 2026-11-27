// Which overlays are open (tour, situation picker). Not saved: a reload starts with them closed.
import { create } from "zustand";

type Ui = {
  tour: boolean;
  situations: boolean;
  /** The recommendation card under the pointer: the live chart marks the day its cause started. */
  hoverDriver: string | null;
};
export const useUi = create<Ui & { set: (p: Partial<Ui>) => void }>((set) => ({
  tour: false,
  situations: false,
  hoverDriver: null,
  set: (p) => set(p),
}));
