// All times are minutes from local midnight of the service date. Values above
// 1440 are allowed so a service can run past midnight (e.g. last booking 00:30 = 1470).

export type Minutes = number;

export interface Table {
  id: string;
  areaId: string;
  minCovers: number;
  maxCovers: number;
  /** Whether guests can be seated here via online booking (staff can still use it). */
  bookableOnline: boolean;
}

/** A set of tables that can be pushed together for a larger party. */
export interface TableCombination {
  id: string;
  tableIds: string[];
  minCovers: number;
  maxCovers: number;
  bookableOnline: boolean;
}

/** Dwell time for parties up to and including `maxCovers`. */
export interface TurnTime {
  maxCovers: number;
  minutes: Minutes;
}

export interface Pacing {
  /** Max covers whose booking starts within one slot interval. */
  maxCoversPerSlot?: number;
  /** Max bookings whose start falls within one slot interval. */
  maxBookingsPerSlot?: number;
}

export interface Service {
  id: string;
  name: string;
  /** 0 = Sunday … 6 = Saturday. */
  daysOfWeek: number[];
  /** First bookable start time. */
  firstSeating: Minutes;
  /** Last bookable start time (inclusive). */
  lastSeating: Minutes;
  slotIntervalMinutes: Minutes;
  turnTimes: TurnTime[];
  /** Reset time added after each booking before a table can be reseated. */
  bufferMinutes: Minutes;
  pacing?: Pacing;
  minCovers: number;
  maxCovers: number;
  /** Restrict this service to certain areas; empty/undefined means all areas. */
  areaIds?: string[];
}

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "seated"
  | "completed"
  | "cancelled"
  | "no_show";

export interface ExistingBooking {
  id: string;
  serviceId: string;
  start: Minutes;
  durationMinutes: Minutes;
  covers: number;
  tableIds: string[];
  status: BookingStatus;
}

/** A table taken out of use for part of the day (maintenance, private hire). */
export interface TableBlock {
  tableId: string;
  start: Minutes;
  end: Minutes;
}

export interface VenueConfig {
  tables: Table[];
  combinations: TableCombination[];
  services: Service[];
}

export interface AvailabilityRequest {
  venue: VenueConfig;
  /** Day of week of the service date, 0 = Sunday. */
  dayOfWeek: number;
  covers: number;
  bookings: ExistingBooking[];
  blocks?: TableBlock[];
  /** Online requests may only use bookableOnline tables. Defaults to "online". */
  channel?: "online" | "staff";
  /** Exclude start times before this (e.g. now + minimum notice) on the same day. */
  notBefore?: Minutes;
}

export interface TableAssignment {
  /** Table id, or combination id when several tables are joined. */
  unitId: string;
  tableIds: string[];
  capacity: number;
  isCombination: boolean;
}

export type UnavailableReason =
  | "party_size_out_of_range"
  | "pacing_covers"
  | "pacing_bookings"
  | "no_table"
  | "too_soon";

export interface Slot {
  serviceId: string;
  time: Minutes;
  durationMinutes: Minutes;
  available: boolean;
  /** Best assignment when available. */
  assignment?: TableAssignment;
  reason?: UnavailableReason;
}
