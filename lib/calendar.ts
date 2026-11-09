import cropsData from '@/data/crops.json';

export type TaskType = 'irrigation' | 'fertilizer' | 'spray' | 'weeding' | 'harvest';

export interface LocalizedText {
  en: string;
  ur: string;
}

export interface CropStage {
  key: string;
  name: LocalizedText;
  startDay: number;
  endDay: number;
}

export interface CropTaskTemplate {
  type: TaskType;
  title: LocalizedText;
  day: number;
  repeatEveryDays?: number;
}

export interface Crop {
  key: string;
  name: LocalizedText;
  season: 'rabi' | 'kharif';
  durationDays: number;
  scanSupported: boolean;
  photoUrl: string;
  sampleYieldMannPerAcre: number;
  samplePricePerMannPkr: number;
  sampleCostsPkr: {
    seed: number;
    fertilizer: number;
    irrigation: number;
    spray: number;
    laborAndHarvest: number;
  };
  stages: CropStage[];
  tasks: CropTaskTemplate[];
  source: string;
}

export interface ScheduledTask {
  id: string;
  type: TaskType;
  title: LocalizedText;
  dayOffset: number;
  dueDate: string; // YYYY-MM-DD
  done: boolean;
}

export function getAllCrops(): Crop[] {
  return cropsData as Crop[];
}

export function getCropByKey(key: string): Crop | undefined {
  return (cropsData as Crop[]).find((c) => c.key === key);
}

/**
 * Adds a day offset to a YYYY-MM-DD date string using UTC math to avoid timezone drift.
 * Note: day=1 is the sowing date itself (offset = day - 1), or if using direct day offset:
 * Section 9.5: "Due date = sowing date + offset. Repeating tasks use repeatEveryDays until harvest."
 */
export function addDaysToDateString(sowingDateStr: string, offsetDays: number): string {
  const [y, m, d] = sowingDateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + offsetDays);
  return dt.toISOString().slice(0, 10);
}

/**
 * Generates the dated task timeline for a crop and sowing date (Section 9.5).
 * Due date = sowingDate + task.day.
 * Repeating tasks repeat every `repeatEveryDays` while `< durationDays`.
 */
export function generateCropCalendar(
  cropKey: string,
  sowingDateStr: string,
  completedTaskIds: string[] = []
): {
  crop: Crop;
  harvestDate: string;
  tasks: ScheduledTask[];
} {
  const crop = getCropByKey(cropKey);
  if (!crop) {
    throw new Error(`Unknown crop key: ${cropKey}`);
  }

  const scheduled: ScheduledTask[] = [];
  const completedSet = new Set(completedTaskIds);

  crop.tasks.forEach((task, idx) => {
    if (task.repeatEveryDays && task.repeatEveryDays > 0) {
      let currentDay = task.day;
      let rep = 1;
      // Repeat until 10 days before harvest so irrigation/spraying doesn't clash with harvest day
      while (currentDay < crop.durationDays - 5) {
        const id = `${crop.key}-${idx}-day-${currentDay}`;
        scheduled.push({
          id,
          type: task.type,
          title: {
            en: rep === 1 ? task.title.en : `${task.title.en} (#${rep})`,
            ur: rep === 1 ? task.title.ur : `${task.title.ur} (${rep})`,
          },
          dayOffset: currentDay,
          dueDate: addDaysToDateString(sowingDateStr, currentDay),
          done: completedSet.has(id),
        });
        currentDay += task.repeatEveryDays;
        rep += 1;
      }
    } else {
      const id = `${crop.key}-${idx}-day-${task.day}`;
      scheduled.push({
        id,
        type: task.type,
        title: task.title,
        dayOffset: task.day,
        dueDate: addDaysToDateString(sowingDateStr, task.day),
        done: completedSet.has(id),
      });
    }
  });

  scheduled.sort((a, b) => a.dayOffset - b.dayOffset);

  return {
    crop,
    harvestDate: addDaysToDateString(sowingDateStr, crop.durationDays),
    tasks: scheduled,
  };
}

export function getCurrentCropStage(crop: Crop, sowingDateStr: string, referenceDateStr?: string): {
  daysSinceSowing: number;
  stage: CropStage;
} {
  const [sy, sm, sd] = sowingDateStr.split('-').map(Number);
  const sowMs = Date.UTC(sy, sm - 1, sd);
  let refMs: number;
  if (referenceDateStr) {
    const [ry, rm, rd] = referenceDateStr.split('-').map(Number);
    refMs = Date.UTC(ry, rm - 1, rd);
  } else {
    const now = new Date();
    refMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }

  const diffDays = Math.max(1, Math.floor((refMs - sowMs) / (1000 * 60 * 60 * 24)));
  const matched =
    crop.stages.find((s) => diffDays >= s.startDay && diffDays <= s.endDay) ||
    (diffDays > crop.durationDays ? crop.stages[crop.stages.length - 1] : crop.stages[0]);

  return {
    daysSinceSowing: diffDays,
    stage: matched,
  };
}
