import { parseISO, getDay, subDays, format } from 'date-fns';

export interface Breakdown {
  totalHours: number;
  basicWork: number;
  basicOT: number;
  extenOT: number;
  nightOT: number;
  holiday: number;
  weeklyBenefit: number;
}

export const calculateBreakdown = (dateStr: string, startStr: string, endStr: string): Breakdown => {
  const [startH, startM] = startStr.split(':').map(Number);
  const [endH, endM] = endStr.split(':').map(Number);
  
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  
  let durationMinutes = endMinutes - startMinutes;
  if (durationMinutes < 0) durationMinutes = 0; 

  // Lunch deduction (12:00 PM to 01:00 PM)
  const lunchStart = 12 * 60;
  const lunchEnd = 13 * 60;
  const overlapStart = Math.max(startMinutes, lunchStart);
  const overlapEnd = Math.min(endMinutes, lunchEnd);
  const lunchOverlap = Math.max(0, overlapEnd - overlapStart);
  
  const workingMinutes = Math.max(0, durationMinutes - lunchOverlap);
  const actualWorkingHours = parseFloat((workingMinutes / 60).toFixed(2));

  const date = parseISO(dateStr);
  const dayOfWeek = getDay(date); 
  const isFri = dayOfWeek === 5;

  let basicWork = 0;
  let basicOT = 0;
  let extenOT = 0;
  let nightOT = 0;
  let holiday = 0;
  let weeklyBenefit = 0; // Benefit is now calculated externally based on weekly attendance
  let calculatedTotal = 0;

  if (actualWorkingHours > 0) {
    if (isFri) {
      // Friday work is doubled (8 hours work = 16 hours total)
      holiday = actualWorkingHours;
      calculatedTotal = (actualWorkingHours * 2);
    } else {
      basicWork = Math.min(actualWorkingHours, 8);
      const remaining = actualWorkingHours - basicWork;
      
      if (remaining > 0) {
        basicOT = Math.min(remaining, 2);
        const remaining2 = remaining - basicOT;
        
        if (remaining2 > 0) {
          extenOT = Math.min(remaining2, 2);
          nightOT = Math.max(0, remaining2 - extenOT);
        }
      }
      // Calculate total with multipliers: B.OT x 1.5, E.OT x 2, N.OT x 2
      calculatedTotal = basicWork + (basicOT * 1.5) + (extenOT * 2) + (nightOT * 2);
    }
  }

  return {
    totalHours: parseFloat(calculatedTotal.toFixed(2)),
    basicWork: parseFloat(basicWork.toFixed(2)),
    basicOT: parseFloat(basicOT.toFixed(2)),
    extenOT: parseFloat(extenOT.toFixed(2)),
    nightOT: parseFloat(nightOT.toFixed(2)),
    holiday: parseFloat(holiday.toFixed(2)),
    weeklyBenefit: parseFloat(weeklyBenefit.toFixed(2))
  };
};

/**
 * Calculates Friday benefit (8 hours) based on attendance of previous 6 days (Sat-Thu).
 * Benefit is given only if basicWork is 8 hours for all 6 days.
 */
export const getFridayBenefit = (fridayDateStr: string, workerEntries: any[]): number => {
  const fridayDate = parseISO(fridayDateStr);
  if (getDay(fridayDate) !== 5) return 0;

  const currentMonth = format(fridayDate, 'yyyy-MM');

  // Check 6 days before: Thu (4), Wed (3), Tue (2), Mon (1), Sun (0), Sat (6)
  for (let i = 1; i <= 6; i++) {
    const checkDate = subDays(fridayDate, i);
    const checkDateStr = format(checkDate, 'yyyy-MM-dd');
    const checkMonth = format(checkDate, 'yyyy-MM');
    const entry = workerEntries.find(e => e.date === checkDateStr);
    
    if (checkMonth === currentMonth) {
      // Current month: must have entry and basicWork >= 8
      if (!entry || (entry.basicWork || 0) < 8) {
        return 0;
      }
    } else {
      // Previous month: 
      // If entry exists, it must be >= 8. 
      // If no entry exists for previous month, we assume they worked (auto-add) 
      // as per user request for mid-week starts.
      if (entry && (entry.basicWork || 0) < 8) {
        return 0;
      }
    }
  }
  
  return 8;
};

export const isFriday = (dateStr: string): boolean => {
  try {
    return getDay(parseISO(dateStr)) === 5;
  } catch {
    return false;
  }
};
