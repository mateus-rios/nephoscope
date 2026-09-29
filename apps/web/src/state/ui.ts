import { create } from 'zustand';

interface UiState {
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  setPalette(open: boolean): void;
  setShortcuts(open: boolean): void;
}

export const useUi = create<UiState>((set) => ({
  paletteOpen: false,
  shortcutsOpen: false,
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setShortcuts: (shortcutsOpen) => set({ shortcutsOpen }),
}));
