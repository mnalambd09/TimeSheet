export type UserRole = 'worker' | 'admin';

export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  role: UserRole;
  hourlyRate?: number;
  division?: string;
  jobTitle?: string;
  arrivalDate?: string;
  passportNo?: string;
  accountHolder?: string;
  accountNo?: string;
  bankName?: string;
  branchName?: string;
  routingNumber?: string;
  deduction?: number;
  canAddTimeEntry?: boolean;
  createdAt: any; // Firestore Timestamp
}

export interface TimesheetEntry {
  id?: string;
  workerId: string;
  workerName: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  breakTime: number;
  totalHours: number;
  basicWork: number;
  basicOT: number;
  extenOT: number;
  nightOT: number;
  holiday: number;
  weeklyBenefit: number;
  status: 'pending' | 'approved' | 'rejected';
  notes?: string;
  createdAt: any; // Firestore Timestamp
}

export interface AppSettings {
  companyName: string;
}
