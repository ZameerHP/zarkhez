'use client';

import React, { useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  FileText,
  FlaskConical,
  Layers,
  MapPin,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { CropDiagnosis, getLocalizedText } from '@/lib/schemas';
import { PAKISTAN_REGION_PROFILES } from '@/lib/vision/knowledge-base';
import { buildStructuredAgronomyReportText } from '@/lib/vision/report-formatter';

const CATEGORY_LABELS: Record<string, { en: string; ur: string; sd: string }> = {
  fungal_infection: { en: 'Fungal Disease', ur: 'پھپھوندی کی بیماری', sd: 'ڦڦوندي جي بيماري' },
  bacterial_infection: { en: 'Bacterial Infection', ur: 'بیکٹیریل بیماری', sd: 'جراثيمي بيماري' },
  viral_infection: { en: 'Viral Disease', ur: 'وائرس کی بیماری', sd: 'وائرس جي بيماري' },
  insect_pest: { en: 'Insect / Pest', ur: 'کیڑوں کا حملہ', sd: 'ڪيڙن جو حملو' },
  nematode_root: { en: 'Root Nematode', ur: 'جڑوں کا کیڑا (نیماٹوڈ)', sd: 'پاڙن جو ڪيڙو' },
  nutrient_deficiency: { en: 'Nutrient Deficiency', ur: 'غذائی کمی', sd: 'خوراڪ / ڀاڻ جي کوٽ' },
  nutrient_toxicity: { en: 'Nutrient Excess', ur: 'کھاد یا نمکیات کی زیادتی', sd: 'ڀاڻ يا لوڻ جي زيادتي' },
  water_stress: { en: 'Water Stress', ur: 'پانی کی کمی یا زیادتی', sd: 'پاڻي جي کوٽ يا زيادتي' },
  heat_stress: { en: 'Heat Stress', ur: 'شدید گرمی کا اثر', sd: 'تيز گرمي جو اثر' },
  cold_frost_damage: { en: 'Frost / Cold', ur: 'کہر / سردی کا اثر', sd: 'سيءَ / پاري جو اثر' },
  sunburn: { en: 'Sunburn', ur: 'تیز دھوپ کا جھلساؤ', sd: 'تيز اُس جو سڙڻ' },
  chemical_herbicide_injury: { en: 'Spray / Herbicide Burn', ur: 'دوا یا سپرے کا اثر', sd: 'دوا يا اسپري جو اثر' },
  soil_salinity: { en: 'Soil Salinity', ur: 'زمینی کلر / نمکیات', sd: 'زمين جو ڪلر' },
  environmental_stress: { en: 'Weather Stress', ur: 'موسمی دباؤ', sd: 'موسم جو اثر' },
  mechanical_physical_damage: { en: 'Physical Damage', ur: 'ظاہری چوٹ / ہوا کا نقصان', sd: 'هوا يا ٻاهرين ڌڪ جو نقصان' },
  post_harvest_storage: { en: 'Storage Issue', ur: 'ذخیرے میں خرابی', sd: 'گودام ۾ خرابي' },
  healthy: { en: 'Healthy Crop', ur: 'تندرست پودا', sd: 'تندرست ٻوٽو' },
  unidentified_or_non_crop: { en: 'Unclear / Other', ur: 'غیر واضح تصویر', sd: 'اڻ چٽي تصوير' },
};

const VISUAL_VALUE_MAP: Record<string, { en: string; ur: string; sd: string }> = {
  none: { en: 'None', ur: 'کوئی نہیں', sd: 'ڪوبه ناهي' },
  zero: { en: 'None', ur: 'کوئی نہیں', sd: 'ڪوبه ناهي' },
  few: { en: 'A few spots', ur: 'چند دھبے', sd: 'ٿورا داغ' },
  several: { en: 'Several spots', ur: 'کئی دھبے', sd: 'ڪيترائي داغ' },
  many: { en: 'Many spots', ur: 'کافی زیادہ دھبے', sd: 'گهڻا داغ' },
  widespread: { en: 'Widespread', ur: 'پوری سطح پر پھیلے ہوئے', sd: 'پوري پن تي پکڙيل' },
  unassessed: { en: 'Not checked', ur: 'جانچ نہیں ہوئی', sd: 'جاچ نه ٿي' },
  spindle_shaped: { en: 'Spindle / diamond shaped', ur: 'نوکیلے / لمبوترے', sd: 'نوڪدار داغ' },
  circular_oval: { en: 'Round / oval spots', ur: 'گول / بیضوی', sd: 'گول داغ' },
  irregular: { en: 'Irregular patches', ur: 'بے ترتیب دھبے', sd: 'بي ترتيب داغ' },
  streaks: { en: 'Long stripes / streaks', ur: 'لمبی لکیریں', sd: 'ڊگهيون ليڪون' },
  well_defined: { en: 'Clear borders', ur: 'واضح کنارے', sd: 'صاف ڪنارا' },
  diffuse: { en: 'Faded borders', ur: 'دھندلے کنارے', sd: 'ڌنڌلا ڪنارا' },
  water_soaked: { en: 'Water-soaked edges', ur: 'گیلے کنارے', sd: 'آلا ڪنارا' },
};

export function formatProblemCategoryLabel(
  category: string | undefined,
  lang: 'en' | 'ur' | 'sd'
): string {
  if (!category) return '';
  const hit = CATEGORY_LABELS[category];
  if (hit) return hit[lang];
  if (lang === 'en') return category.replace(/_/g, ' ');
  return lang === 'sd' ? 'فصل جي حالت' : 'زرعی کیفیت';
}

export function formatVisualMetricLabel(
  raw: string | undefined,
  lang: 'en' | 'ur' | 'sd'
): string {
  if (!raw) return lang === 'en' ? 'None' : lang === 'sd' ? 'ڪوبه ناهي' : 'کوئی نہیں';
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const hit = VISUAL_VALUE_MAP[key];
  if (hit) return hit[lang];
  if (lang === 'en') return raw.replace(/_/g, ' ');
  return /[a-z_]/i.test(raw) ? (lang === 'sd' ? 'داغ موجود' : 'دھبے موجود') : raw;
}

export function RegionSelectorBar({
  locale,
  region,
  onRegionChange,
}: {
  locale: 'en' | 'ur';
  region: string;
  onRegionChange: (r: string) => void;
}) {
  return (
    <div className="bg-white rounded-2xl px-3.5 py-2.5 shadow-soft border border-olive/15 flex items-center justify-between gap-2 flex-wrap text-start">
      <label className="text-[11px] font-extrabold text-ink/75 flex items-center gap-1.5">
        <MapPin className="w-3.5 h-3.5 text-olive" />
        <span>{locale === 'ur' ? 'علاقہ (اختیاری):' : 'Region (Optional):'}</span>
      </label>
      <select
        value={region}
        onChange={(e) => onRegionChange(e.target.value)}
        className="text-base sm:text-sm font-bold bg-canvas border border-olive/20 rounded-xl px-2.5 py-2 min-h-[44px] text-ink w-full sm:w-auto sm:max-w-[260px]"
      >
        <option value="">{locale === 'ur' ? 'تمام علاقے (خودکار)' : 'Auto / Any Region'}</option>
        {PAKISTAN_REGION_PROFILES.map((rp) => (
          <option key={rp.key} value={rp.key}>
            {locale === 'ur' ? rp.ur : rp.en}
          </option>
        ))}
      </select>
    </div>
  );
}

export function TechnicalDetailsDrawer({
  diagnosis,
  reportLang,
  region,
}: {
  diagnosis: CropDiagnosis;
  reportLang: 'en' | 'ur' | 'sd';
  region?: string;
}) {
  const [open, setOpen] = useState(false);
  const [fbStatus, setFbStatus] = useState<'idle' | 'editing' | 'submitting' | 'submitted'>('idle');
  const [correctedDisease, setCorrectedDisease] = useState('');
  const [correctedCrop, setCorrectedCrop] = useState('');
  const [notes, setNotes] = useState('');
  const [consentForDataset, setConsentForDataset] = useState(false);
  const [serverMsg, setServerMsg] = useState('');

  const cb = diagnosis.confidence_breakdown;
  const modelPct = Math.round((cb?.model_confidence ?? diagnosis.identification_confidence ?? 0) * 100);
  const certaintyPct = Math.round((cb?.diagnostic_certainty ?? diagnosis.identification_confidence ?? 0) * 100);

  const handleDownloadReport = () => {
    const content = buildStructuredAgronomyReportText(diagnosis, reportLang === 'en' ? 'en' : 'ur');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeCrop = (diagnosis.detected_crop || 'crop').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    a.href = url;
    a.download = `zarkhez-report-${safeCrop}-${reportLang}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const sendFeedback = async (verdict: 'correct' | 'incorrect') => {
    setFbStatus('submitting');
    try {
      const res = await fetch('/api/scan/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scanId: diagnosis.scan_timestamp || `scan-${Date.now()}`,
          modelVersion: diagnosis.model_version || 'zarkhez-vision-v2.4-cloud',
          verdict,
          predictedCrop: diagnosis.detected_crop,
          predictedProblem: diagnosis.problem_name.en,
          correctedCrop: correctedCrop.trim() || undefined,
          correctedDisease: correctedDisease.trim() || undefined,
          region: region || undefined,
          notes: notes.trim() || undefined,
          consentForDataset,
        }),
      });
      const data = await res.json();
      setServerMsg(
        data?.message
          ? reportLang === 'en' ? data.message.en : data.message.ur
          : reportLang === 'en' ? 'Feedback recorded cleanly.' : 'آپ کی رائے محفوظ کر لی گئی ہے۔'
      );
      setFbStatus('submitted');
    } catch {
      setServerMsg(
        reportLang === 'en'
          ? 'Could not send feedback right now (check connection).'
          : 'انٹرنیٹ نہ ہونے کی وجہ سے رائے نہیں بھیجی جا سکی۔'
      );
      setFbStatus('idle');
    }
  };

  return (
    <div className="space-y-2.5 text-start">
      {diagnosis.safety_guardrail_notes && diagnosis.safety_guardrail_notes.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-3 space-y-1 text-red-900 text-xs">
          <div className="font-black flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-red-600" />
            <span>{reportLang === 'en' ? 'Safety Notice' : 'حفاظتی انتباہ'}</span>
          </div>
          {diagnosis.safety_guardrail_notes.map((n, i) => (
            <p key={i} className="leading-snug">
              {getLocalizedText(n, reportLang)}
            </p>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full py-2.5 px-4 rounded-2xl bg-canvas hover:bg-olive/10 border border-olive/20 text-ink font-extrabold text-xs flex items-center justify-between transition-all"
      >
        <span className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-olive" />
          <span>
            {reportLang === 'en'
              ? 'More Details: Similar Diseases, Scientific Info & Feedback'
              : 'مزید تفصیلات: ملتی جلتی بیماریاں، سائنسی معلومات اور رائے'}
          </span>
        </span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="bg-canvas/70 rounded-2xl p-3.5 border border-olive/15 space-y-3 text-xs">
          {/* Differential Possibilities */}
          {diagnosis.differential_diagnoses && diagnosis.differential_diagnoses.length > 0 && (
            <div className="space-y-2">
              <span className="font-black text-[11px] text-ink/75 uppercase flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-olive" />
                <span>
                  {reportLang === 'en'
                    ? 'Other Similar Possibilities Checked'
                    : 'ملتی جلتی دیگر ممکنہ بیماریاں'}
                </span>
              </span>
              {diagnosis.differential_diagnoses.map((diff, idx) => (
                <div key={idx} className="bg-white p-2.5 rounded-xl border border-olive/15 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-ink">{diff.name}</strong>
                    {diff.scientific_name && (
                      <span className="text-[10px] italic text-ink/55">{diff.scientific_name}</span>
                    )}
                  </div>
                  <p className="text-ink/80 leading-snug">
                    {getLocalizedText(diff.differences, reportLang)}
                  </p>
                  <p className="text-[11px] text-emerald-900 font-medium flex items-start gap-1">
                    <Sparkles className="w-3 h-3 text-emerald-600 flex-shrink-0 mt-0.5" />
                    <span>{getLocalizedText(diff.field_distinction_tip, reportLang)}</span>
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Clean Localized Lesion Inspection Summary */}
          {diagnosis.visual_inspection && diagnosis.visual_inspection.lesion_detected && (
            <div className="bg-white p-2.5 rounded-xl border border-olive/10 grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-ink/55 block font-bold">
                  {reportLang === 'en' ? 'Spots Seen:' : 'دھبوں کی مقدار:'}
                </span>
                <strong className="text-ink">
                  {formatVisualMetricLabel(diagnosis.visual_inspection.lesion_count, reportLang)}
                </strong>
              </div>
              <div>
                <span className="text-ink/55 block font-bold">
                  {reportLang === 'en' ? 'Shape:' : 'دھبوں کی شکل:'}
                </span>
                <strong className="text-ink">
                  {formatVisualMetricLabel(diagnosis.visual_inspection.lesion_shape, reportLang)}
                </strong>
              </div>
            </div>
          )}

          {/* Calibrated Certainty & Scientific Context */}
          {cb && (
            <div className="bg-white p-2.5 rounded-xl border border-olive/10 space-y-1 text-[11px]">
              <div className="flex items-center justify-between flex-wrap gap-1">
                <span className="font-bold text-ink">
                  {reportLang === 'en'
                    ? `Certainty: ${certaintyPct}% (Raw AI: ${modelPct}%)`
                    : `حقیقی یقین: ${certaintyPct}% (ماڈل سکور: ${modelPct}%)`}
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-900 border border-amber-200">
                  {reportLang === 'en' ? 'Visual Check (Not Lab Proof)' : 'بصری جائزہ (لیب ٹیسٹ نہیں)'}
                </span>
              </div>
              {diagnosis.explanations?.scientific && (
                <p className="text-ink/75 leading-snug pt-1">
                  {getLocalizedText(diagnosis.explanations.scientific, reportLang)}
                </p>
              )}
              {diagnosis.yield_impact && (
                <p className="text-ink/80 leading-snug">
                  <strong>{reportLang === 'en' ? 'Yield Risk: ' : 'پیداوار پر اثر: '}</strong>
                  {getLocalizedText(diagnosis.yield_impact, reportLang)}
                </p>
              )}
            </div>
          )}

          {/* Verified References */}
          {diagnosis.scientific_references && diagnosis.scientific_references.length > 0 && (
            <div className="bg-white p-2.5 rounded-xl border border-olive/10 space-y-1 text-[11px]">
              <span className="font-bold text-ink/75 flex items-center gap-1">
                <BookOpen className="w-3.5 h-3.5 text-olive" />
                <span>{reportLang === 'en' ? 'Agricultural References' : 'مستند زرعی ذرائع'}</span>
              </span>
              {diagnosis.scientific_references.map((ref, i) => (
                <div key={i} className="flex items-center justify-between gap-2 text-ink/75">
                  <span>[{ref.source}] {ref.title}</span>
                  {ref.url && (
                    <a href={ref.url} target="_blank" rel="noreferrer" className="text-olive flex-shrink-0">
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Download Full Report */}
          <button
            type="button"
            onClick={handleDownloadReport}
            className="w-full py-2.5 px-3 rounded-xl bg-white hover:bg-olive/5 border border-olive/25 text-ink font-bold text-xs flex items-center justify-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5 text-olive" />
            <FileText className="w-3.5 h-3.5 text-olive" />
            <span>
              {reportLang === 'en' ? 'Download Complete Report (.txt)' : 'مکمل رپورٹ ڈاؤن لوڈ کریں'}
            </span>
          </button>

          {/* Accuracy Feedback */}
          <div className="bg-white p-2.5 rounded-xl border border-olive/10 space-y-2">
            <span className="font-bold text-ink block text-[11px]">
              {reportLang === 'en'
                ? 'Was this scan helpful and accurate?'
                : 'کیا یہ نتیجہ درست اور مددگار تھا؟'}
            </span>
            {fbStatus === 'submitted' ? (
              <div className="flex items-center gap-1.5 text-emerald-800 font-semibold text-[11px]">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>{serverMsg}</span>
              </div>
            ) : (
              <>
                {serverMsg && (
                  <p className="text-[11px] font-semibold text-alert-amber">{serverMsg}</p>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={fbStatus === 'submitting'}
                    onClick={() => sendFeedback('correct')}
                    className="flex-1 min-h-[44px] py-2 px-2 rounded-lg bg-emerald-50 text-emerald-900 border border-emerald-200 font-bold text-[11px] sm:text-xs flex items-center justify-center gap-1"
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                    <span>{reportLang === 'en' ? 'Yes, Accurate' : 'جی درست ہے'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={fbStatus === 'submitting'}
                    onClick={() => setFbStatus(fbStatus === 'editing' ? 'idle' : 'editing')}
                    className="flex-1 min-h-[44px] py-2 px-2 rounded-lg bg-amber-50 text-amber-900 border border-amber-200 font-bold text-[11px] sm:text-xs flex items-center justify-center gap-1"
                  >
                    <ThumbsDown className="w-3.5 h-3.5" />
                    <span>{reportLang === 'en' ? 'Needs Correction' : 'درستگی بتائیں'}</span>
                  </button>
                </div>
                {fbStatus === 'editing' && (
                  <div className="space-y-2 pt-1">
                    <input
                      type="text"
                      value={correctedCrop}
                      onChange={(e) => setCorrectedCrop(e.target.value)}
                      placeholder={reportLang === 'en' ? 'Correct crop name' : 'درست فصل کا نام'}
                      className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-canvas border border-olive/20 text-base sm:text-sm"
                    />
                    <input
                      type="text"
                      value={correctedDisease}
                      onChange={(e) => setCorrectedDisease(e.target.value)}
                      placeholder={reportLang === 'en' ? 'Confirmed disease name' : 'درست بیماری کا نام'}
                      className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-canvas border border-olive/20 text-base sm:text-sm"
                    />
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      placeholder={reportLang === 'en' ? 'Extra notes...' : 'اضافی بات (اختیاری)'}
                      className="w-full px-3 py-2 rounded-lg bg-canvas border border-olive/20 text-base sm:text-sm"
                    />
                    <label className="flex items-start gap-1.5 text-[10px] text-ink/75">
                      <input
                        type="checkbox"
                        checked={consentForDataset}
                        onChange={(e) => setConsentForDataset(e.target.checked)}
                      />
                      <span>
                        {reportLang === 'en'
                          ? 'Save for expert review (never changes AI automatically without verification).'
                          : 'ماہر کے جائزے کے لیے محفوظ کریں۔'}
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() => sendFeedback('incorrect')}
                      className="w-full min-h-[44px] py-2 rounded-lg bg-[#062409] text-white font-bold text-xs"
                    >
                      {reportLang === 'en' ? 'Send Feedback' : 'بھیجیں'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex items-start gap-1.5 text-[10px] text-ink/65">
            <ShieldCheck className="w-3.5 h-3.5 text-olive flex-shrink-0 mt-0.5" />
            <span>
              {reportLang === 'en'
                ? 'Visual screening cannot guarantee 100% accuracy. Confirm serious outbreaks with your agriculture officer or lab.'
                : 'بصری جائزہ 100 فیصد حتمی نہیں ہوتا؛ شدید مسئلے میں مقامی زرعی ماہر سے تصدیق ضرور کروائیں۔'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
