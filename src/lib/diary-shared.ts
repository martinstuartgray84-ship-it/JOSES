// Status rules shared by the diary UI (which buttons to show) and the server (what to allow).

export type DiaryStatus = "pending" | "confirmed" | "seated" | "completed" | "cancelled" | "no_show";

const TRANSITIONS: Record<DiaryStatus, DiaryStatus[]> = {
  pending: ["confirmed", "seated", "cancelled", "no_show"],
  confirmed: ["seated", "cancelled", "no_show"],
  seated: ["completed", "confirmed"],
  completed: ["seated"],
  cancelled: ["confirmed"],
  no_show: ["confirmed", "seated"],
};

export function allowedTransitions(from: DiaryStatus): DiaryStatus[] {
  return TRANSITIONS[from];
}

export const STATUS_LABEL: Record<DiaryStatus, string> = {
  pending: "Pending",
  confirmed: "Booked",
  seated: "Seated",
  completed: "Finished",
  cancelled: "Cancelled",
  no_show: "No-show",
};

/** Button text for moving *to* a status. */
export const ACTION_LABEL: Record<DiaryStatus, string> = {
  pending: "Mark pending",
  confirmed: "Back to booked",
  seated: "Seat",
  completed: "Finish / table free",
  cancelled: "Cancel booking",
  no_show: "No-show",
};

/** Statuses that occupy a table on the floor. */
export const HOLDS_TABLE: DiaryStatus[] = ["pending", "confirmed", "seated"];
