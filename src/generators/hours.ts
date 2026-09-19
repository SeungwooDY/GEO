import { DAYS, type Day, type HoursEntry } from './businessProfile.js';

/** "07:00" -> "7am", "19:30" -> "7:30pm", "00:00" -> "12am". */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, '0')}${suffix}`;
}

/** Collapses days into readable runs in week order: [Mon..Sat] -> "Monday-Saturday", [Mon, Wed] -> "Monday, Wednesday". */
export function formatDays(days: Day[]): string {
  const indexes = [...new Set(days.map((d) => DAYS.indexOf(d)))].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const i of indexes) {
    const last = runs[runs.length - 1];
    if (last && i === last[last.length - 1] + 1) last.push(i);
    else runs.push([i]);
  }
  return runs
    .map((run) => (run.length >= 3 ? `${DAYS[run[0]]}-${DAYS[run[run.length - 1]]}` : run.map((i) => DAYS[i]).join(', ')))
    .join(', ');
}

export function formatHoursLine(entry: HoursEntry): string {
  return `${formatDays(entry.days)}: ${formatTime(entry.opens)}-${formatTime(entry.closes)}`;
}
