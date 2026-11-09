import assert from 'node:assert/strict';
import { computeWeatherAlerts, DailyForecastInput } from '../lib/alerts';
import {
  addDaysToDateString,
  generateCropCalendar,
  getCurrentCropStage,
  getCropByKey,
} from '../lib/calendar';
import { calculateFertilizer } from '../lib/fertilizer';
import { calculateProfit } from '../lib/profit';
import { generateFarmerPersonaId } from '../lib/supabase/client';
import { analyzeImageData } from '../lib/image-quality';

let passed = 0;
let failed = 0;

function testCase(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ FAIL: ${name}`, err);
  }
}

console.log('\n🧪 Running Zarkhez Unit Tests (Alerts, Calendar, Fertilizer, Profit)...\n');

const baseDay: DailyForecastInput = {
  date: '2026-11-09',
  tempMax: 30,
  tempMin: 16,
  precipitationSum: 0,
  precipitationProbMax: 10,
  windSpeedMax: 2.5,
};

testCase('Alert Rules: triggers heatwave only when 40C+ occurs on 2 consecutive days', () => {
  const singleHotDay = [
    { ...baseDay, date: '2026-06-01', tempMax: 41 },
    { ...baseDay, date: '2026-06-02', tempMax: 38 },
  ];
  assert.equal(
    computeWeatherAlerts(singleHotDay).some((a) => a.type === 'heatwave'),
    false
  );

  const twoConsecutiveHotDays = [
    { ...baseDay, date: '2026-06-01', tempMax: 40 },
    { ...baseDay, date: '2026-06-02', tempMax: 42 },
  ];
  assert.equal(
    computeWeatherAlerts(twoConsecutiveHotDays).some((a) => a.type === 'heatwave'),
    true
  );
});

testCase('Alert Rules: triggers heavy_rain when rain probability >= 60% OR precipitation >= 10 mm', () => {
  const probRain = [{ ...baseDay, precipitationProbMax: 65 }];
  assert.equal(
    computeWeatherAlerts(probRain).some((a) => a.type === 'heavy_rain'),
    true
  );

  const mmRain = [{ ...baseDay, precipitationProbMax: 30, precipitationSum: 12 }];
  assert.equal(
    computeWeatherAlerts(mmRain).some((a) => a.type === 'heavy_rain'),
    true
  );
});

testCase('Alert Rules: triggers frost when daily minimum temperature is 2C or below', () => {
  const frostForecast = [
    baseDay,
    { ...baseDay, date: '2026-12-20', tempMin: 1.5 },
  ];
  assert.equal(
    computeWeatherAlerts(frostForecast).some((a) => a.type === 'frost'),
    true
  );
});

testCase('Alert Rules: triggers spray_warning when next 24h has rain prob >= 40% or wind >= 5 m/s', () => {
  const windyToday = [{ ...baseDay, windSpeedMax: 5.2 }];
  assert.equal(
    computeWeatherAlerts(windyToday).some((a) => a.type === 'spray_warning'),
    true
  );

  const rainyToday = [{ ...baseDay, precipitationProbMax: 40 }];
  assert.equal(
    computeWeatherAlerts(rainyToday).some((a) => a.type === 'spray_warning'),
    true
  );
});

testCase('Crop Calendar: computes exact due dates and harvest date from sowing date', () => {
  assert.equal(addDaysToDateString('2026-11-01', 22), '2026-11-23');

  const cal = generateCropCalendar('wheat', '2026-11-01', ['wheat-0-day-1']);
  assert.equal(cal.harvestDate, '2027-03-31');
  assert.equal(cal.tasks[0].done, true);

  const firstIrrigation = cal.tasks.find((t) => t.dayOffset === 22);
  assert.equal(firstIrrigation?.dueDate, '2026-11-23');
});

testCase('Crop Calendar: expands repeating tasks (repeatEveryDays) until harvest', () => {
  const riceCal = generateCropCalendar('rice', '2026-07-01');
  const irrigationTasks = riceCal.tasks.filter((t) => t.type === 'irrigation');
  assert.equal(irrigationTasks.length > 5, true);
  assert.equal(irrigationTasks[0].dayOffset, 7);
  assert.equal(irrigationTasks[1].dayOffset, 21);
});

testCase('Crop Calendar: identifies current crop stage accurately', () => {
  const wheat = getCropByKey('wheat')!;
  const stageInfo = getCurrentCropStage(wheat, '2026-11-01', '2026-12-05');
  assert.equal(stageInfo.daysSinceSowing, 34);
  assert.equal(stageInfo.stage.key, 'tillering');
});

testCase('Fertilizer Calculator: matches hand-calculated per-acre and total amounts with source', () => {
  const res = calculateFertilizer('wheat', 'medium', 4);
  assert.equal(res.source.includes('Agriculture Dept Punjab'), true);

  const dap = res.items.find((i) => i.product === 'DAP')!;
  assert.equal(dap.kgPerAcre, 50);
  assert.equal(dap.totalKg, 200);
  assert.equal(dap.bags50Kg, 4);

  const urea = res.items.find((i) => i.product === 'Urea')!;
  assert.equal(urea.kgPerAcre, 100);
  assert.equal(urea.totalKg, 400);
  assert.equal(urea.bags50Kg, 8);
});

testCase('Profit Calculator: matches hand-calculated income, costs, and -30%..+30% price slider', () => {
  const base = calculateProfit({
    areaAcres: 2,
    yieldPerAcre: 40,
    basePricePerUnit: 4000,
    priceSliderPercent: 0,
    costsPerAcre: {
      seed: 10000,
      fertilizer: 30000,
      irrigation: 15000,
      spray: 5000,
      laborAndHarvest: 20000,
    },
  });

  assert.equal(base.costPerAcre, 80000);
  assert.equal(base.grossIncomePerAcre, 160000);
  assert.equal(base.profitPerAcre, 80000);
  assert.equal(base.totalNetProfit, 160000);

  const plus20 = calculateProfit({
    areaAcres: 2,
    yieldPerAcre: 40,
    basePricePerUnit: 4000,
    priceSliderPercent: 20,
    costsPerAcre: {
      seed: 10000,
      fertilizer: 30000,
      irrigation: 15000,
      spray: 5000,
      laborAndHarvest: 20000,
    },
  });
  assert.equal(plus20.effectivePricePerUnit, 4800);
  assert.equal(plus20.profitPerAcre, 112000);
  assert.equal(plus20.totalNetProfit, 224000);
});

testCase('Profit Calculator: handles empty or negative inputs gracefully without NaN', () => {
  const empty = calculateProfit({
    areaAcres: Number.NaN,
    yieldPerAcre: -10,
    basePricePerUnit: 0,
    costsPerAcre: {},
  });
  assert.equal(empty.totalNetProfit, 0);
  assert.equal(empty.profitPerAcre, 0);
});

testCase('Farmer Persona ID: generates deterministic ZRK-PK-XXXXXX ID from Google email', () => {
  const id1 = generateFarmerPersonaId('akram.kisan@gmail.com');
  const id2 = generateFarmerPersonaId('akram.kisan@gmail.com');
  assert.equal(id1, id2);
  assert.match(id1, /^ZRK-PK-\d{6}$/);
});

testCase('Image Quality: accurately flags blurry / flat image via Laplacian variance', () => {
  // 10x10 completely uniform pixels (zero Laplacian variance)
  const uniformData = new Uint8ClampedArray(10 * 10 * 4);
  for (let i = 0; i < uniformData.length; i += 4) {
    uniformData[i] = 120;     // R
    uniformData[i + 1] = 120; // G
    uniformData[i + 2] = 120; // B
    uniformData[i + 3] = 255;
  }
  const report = analyzeImageData(uniformData, 10, 10);
  assert.equal(report.isBlurry, true);
  assert.equal(report.blurScore, 0);
  assert.ok(report.friendlyMessageUr?.includes('دھندلی'));
});

testCase('Image Quality: accurately flags dark and overexposed photos', () => {
  // Dark image
  const darkData = new Uint8ClampedArray(10 * 10 * 4);
  for (let i = 0; i < darkData.length; i += 4) {
    darkData[i] = 15;
    darkData[i + 1] = 20;
    darkData[i + 2] = 15;
    darkData[i + 3] = 255;
  }
  const darkReport = analyzeImageData(darkData, 10, 10);
  assert.equal(darkReport.isDark, true);
  assert.equal(darkReport.isOverexposed, false);

  // Overexposed image
  const brightData = new Uint8ClampedArray(10 * 10 * 4);
  for (let i = 0; i < brightData.length; i += 4) {
    brightData[i] = 245;
    brightData[i + 1] = 250;
    brightData[i + 2] = 240;
    brightData[i + 3] = 255;
  }
  const brightReport = analyzeImageData(brightData, 10, 10);
  assert.equal(brightReport.isOverexposed, true);
});

testCase('Image Quality: recognizes healthy and infected plant pixels in subjectRatio', () => {
  // Image with 60% green leaf pixels
  const leafData = new Uint8ClampedArray(10 * 10 * 4);
  for (let i = 0; i < leafData.length; i += 4) {
    if (i < leafData.length * 0.6) {
      leafData[i] = 40;      // R
      leafData[i + 1] = 150; // G (dominant green)
      leafData[i + 2] = 30;  // B
    } else {
      leafData[i] = 200;     // White background
      leafData[i + 1] = 200;
      leafData[i + 2] = 200;
    }
    leafData[i + 3] = 255;
  }
  const report = analyzeImageData(leafData, 10, 10);
  assert.equal(report.isTooSmall, false);
  assert.ok(report.subjectRatio >= 0.5);
});

console.log(`\n🎉 Unit Test Summary: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) {
  process.exit(1);
}
