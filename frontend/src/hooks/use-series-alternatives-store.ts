import { create } from "zustand";
import { toast } from "sonner";
import type { SeriesSession } from "@zenflow/shared";

/** One divergent sitting the alternatives dialog can offer a swap for. */
export interface SeriesAlternative {
  sessionId: string;
  slotProposalId: string;
  primarySlot: string;
  alternativeSlot: string;
  durationMinutes: number;
  /** 1-based sitting index within the series. */
  index: number;
}

export interface PendingSeriesAlternatives {
  title: string;
  /** Total sittings in the series (the "M" in "N of M"). */
  total: number;
  /** Only the divergent sittings, soonest first — never all M. */
  sittings: SeriesAlternative[];
}

type State = {
  pending: PendingSeriesAlternatives | null;
  open: boolean;
};

type Action = {
  /** Stash a series' alternatives (replacing any earlier ones), dialog closed. */
  setPending: (pending: PendingSeriesAlternatives) => void;
  openDialog: () => void;
  /** Close and forget — anything not swapped stays as scheduled. */
  clear: () => void;
};

export const useSeriesAlternativesStore = create<State & Action>((set) => ({
  pending: null,
  open: false,
  setPending: (pending) => set({ pending, open: false }),
  openDialog: () => set((s) => (s.pending ? { open: true } : s)),
  clear: () => set({ pending: null, open: false }),
}));

const TOAST_ID = "series-alternatives";

/**
 * After a series create / redistribute: if any sitting came back divergent,
 * stash its alternatives and raise a non-blocking toast with a **View**
 * action that opens `SeriesAlternativesDialog`. Every sitting is already
 * scheduled at its primary pick, so no prompt is shown otherwise.
 */
export function promptSeriesAlternatives(
  title: string,
  sessions: SeriesSession[] | undefined,
): void {
  if (!sessions || sessions.length < 2) return;
  const sittings: SeriesAlternative[] = sessions
    .map((s, i) => ({ s, i }))
    .filter(
      ({ s }) =>
        s.divergent &&
        !!s.slotProposalId &&
        !!s.alternativeSlot &&
        !!(s.primarySlot ?? s.scheduledStartTime),
    )
    .map(({ s, i }) => ({
      sessionId: s.id,
      slotProposalId: s.slotProposalId as string,
      primarySlot: (s.primarySlot ?? s.scheduledStartTime) as string,
      alternativeSlot: s.alternativeSlot as string,
      durationMinutes: s.durationMinutes,
      index: s.sessionIndex ?? i + 1,
    }));
  if (sittings.length === 0) return;

  const total = sessions[0].sessionTotal ?? sessions.length;
  const { setPending, openDialog } = useSeriesAlternativesStore.getState();
  setPending({ title, total, sittings });

  const n = sittings.length;
  toast(`${n} ${n === 1 ? "sitting has" : "sittings have"} an alternative`, {
    id: TOAST_ID,
    description: `All ${total} are already scheduled — swap any you like.`,
    duration: 15_000,
    closeButton: true,
    action: { label: "View", onClick: openDialog },
  });
}
