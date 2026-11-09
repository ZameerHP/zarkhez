/**
 * Deterministic Agricultural Weather Alert Rules (Section 9.3 of SPEC.md)
 *
 * Starting rules:
 * - Heatwave: Daily maximum 40 C or more on 2 or more days in a row
 * - Heavy rain: Rain probability 60 percent or more, or 10 mm or more in a day
 * - Frost: Daily minimum 2 C or below
 * - Spray warning: Next 24 hours: rain probability 40 percent or more, or wind 5 m/s or more
 */

export type AlertType = 'heatwave' | 'heavy_rain' | 'frost' | 'spray_warning';
export type AlertLevel = 'watch' | 'warning';

export interface WeatherAlert {
  type: AlertType;
  level: AlertLevel;
  day: string;
  titleKey: string;
  descKey: string;
}

export interface DailyForecastInput {
  date: string;
  tempMax: number;
  tempMin: number;
  precipitationSum: number;
  precipitationProbMax: number;
  windSpeedMax: number; // m/s
  weatherCode?: number;
}

export function computeWeatherAlerts(daily: DailyForecastInput[]): WeatherAlert[] {
  const alerts: WeatherAlert[] = [];
  if (!daily || daily.length === 0) return alerts;

  // 1. Spray warning (Next 24 hours / Day 0): rain probability >= 40% OR wind >= 5 m/s
  const today = daily[0];
  if (today.precipitationProbMax >= 40 || today.windSpeedMax >= 5) {
    alerts.push({
      type: 'spray_warning',
      level: today.precipitationProbMax >= 60 || today.windSpeedMax >= 7 ? 'warning' : 'watch',
      day: today.date,
      titleKey: 'alerts.sprayWarningTitle',
      descKey: 'alerts.sprayWarningDesc',
    });
  }

  // 2. Heatwave: Daily maximum >= 40 C on 2 or more days in a row
  for (let i = 0; i < daily.length - 1; i++) {
    if (daily[i].tempMax >= 40 && daily[i + 1].tempMax >= 40) {
      alerts.push({
        type: 'heatwave',
        level: daily[i].tempMax >= 43 || daily[i + 1].tempMax >= 43 ? 'warning' : 'watch',
        day: daily[i].date,
        titleKey: 'alerts.heatwaveTitle',
        descKey: 'alerts.heatwaveDesc',
      });
      break; // Report first consecutive heatwave onset
    }
  }

  // 3. Heavy rain: Rain probability >= 60% OR 10 mm or more in a day
  for (const d of daily) {
    if (d.precipitationProbMax >= 60 || d.precipitationSum >= 10) {
      alerts.push({
        type: 'heavy_rain',
        level: d.precipitationSum >= 20 || d.precipitationProbMax >= 80 ? 'warning' : 'watch',
        day: d.date,
        titleKey: 'alerts.heavyRainTitle',
        descKey: 'alerts.heavyRainDesc',
      });
      break; // Report first upcoming heavy rain day
    }
  }

  // 4. Frost: Daily minimum <= 2 C
  for (const d of daily) {
    if (d.tempMin <= 2) {
      alerts.push({
        type: 'frost',
        level: d.tempMin <= 0 ? 'warning' : 'watch',
        day: d.date,
        titleKey: 'alerts.frostTitle',
        descKey: 'alerts.frostDesc',
      });
      break;
    }
  }

  return alerts;
}
