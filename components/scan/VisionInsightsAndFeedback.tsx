'use client';

import React, { useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  FlaskConical,
  Layers,
  MapPin,
  Plus,
  ShieldAlert,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import { CropDiagnosis, getLocalizedText } from '@/lib/schemas';
import { PAKISTAN_REGION_PROFILES } from '@/lib/vision/knowledge-base';
import { buildStructuredAgronomyReportText } from '@/lib/vision/report-formatter';
import { compressAndAssessLeafImage } from '@/lib/image-quality';

interface MultiFieldPanelProps {
  locale: 'en' | 'ur';
  scanMode: 'single_plant' | 'whole_field';
  onScanModeChange: (mode: 'single_plant' | 'whole_field') => void;
  region: string;
  onRegionChange: (r: string) => void;
  additionalImages: string[];
  onAddExtraImage: (dataUrl: string) => void;
  onRemoveExtraImage: (idx: number) => void;
}

export function ScanModeAndFieldContextPanel({
  locale,
  scanMode,
  onScanModeChange,
  region,
  onRegionChange,
  additionalImages,
  onAddExtraImage,
  onRemoveExtraImage,
}: MultiFieldPanelProps) {
  const [addingExtra, setAddingExtra] = useState(false);

  const handleExtraFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || additionalImages.length >= 3) return;
    setAddingExtra(true);
    try {
      const compressed = await compressAndAssessLeafImage(file);
      onAddExtraImage(compressed.fullDataUrl);
    } catch {
      // ignore corrupted frame safely
    } finally {
      setAddingExtra(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl p-3.5 shadow-soft border border-olive/15 space-y-3 text-start">
      <div className="grid grid-cols-2 gap-1.5 bg-canvas p-1 rounded-xl border border-olive/15">
        <button
          type="button"
          onClick={() => onScanModeChange('single_plant')}
          className={`py-2 px-2.5 rounded-lg text-xs font-extrabold transition-all flex items-center justify-center gap-1.5 ${
            scanMode === 'single_plant'
              ? 'bg-[#062409] text-white shadow-sm'
              : 'text-ink/75 hover:bg-olive/10'
          }`}
        >
          <Layers className="w-3.5 h-3.5 text-emerald-400" />
          <span>{locale === 'ur' ? 'انفرادی پودا / حصہ' : 'Single Plant / Organ'}</span>
        </button>

        <button
          type="button"
          onClick={() => onScanModeChange('whole_field')}
          className={`py-2 px-2.5 rounded-lg text-xs font-extrabold transition-all flex items-center justify-center gap-1.5 ${
            scanMode === 'whole_field'
              ? 'bg-[#062409] text-white shadow-sm'
              : 'text-ink/75 hover:bg-olive/10'
          }`}
        >
          <MapPin className="w-3.5 h-3.5 text-emerald-400" />
          <span>{locale === 'ur' ? 'پورا کھیت (متعدد تصاویر)' : 'Whole Field (Multi-Photo)'}</span>
        </button>
      </div>

      {/* Geographical Region Selector */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className="text-[11px] font-extrabold text-ink/75 flex items-center gap-1">
          <MapPin className="w-3.5 h-3.5 text-olive" />
          <span>{locale === 'ur' ? 'علاقہ (موسم کے حساب سے):' : 'Region / Agro-Zone:'}</span>
        </label>
        <select
          value={region}
          onChange={(e) => onRegionChange(e.target.value)}
          className="text-xs font-bold bg-canvas border border-olive/20 rounded-xl px-2.5 py-1.5 text-ink max-w-[230px]"
        >
          <option value="">{locale === 'ur' ? 'عام / کوئی بھی علاقہ' : 'Auto / General Region'}</option>
          {PAKISTAN_REGION_PROFILES.map((rp) => (
            <option key={rp.key} value={rp.key}>
              {locale === 'ur' ? rp.ur : rp.en}
            </option>
          ))}
        </select>
      </div>

      {scanMode === 'whole_field' && (
        <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-2.5 space-y-2">
          <p className="text-[11px] text-emerald-950 font-semibold leading-snug">
            {locale === 'ur'
              ? 'پورے کھیت کے درست اندازے کے لیے کھیت کے مختلف کونوں یا مختلف حصوں (پتا، تنا، جڑ/بھٹہ) کی 3 تک اضافی تصاویر شامل کریں، پھر مرکزی تصویر لیں:'
              : 'Add up to 3 additional field-corner or close-up angle photos before taking your primary scan photo so whole-field distribution can be assessed honestly:'}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {additionalImages.map((src, i) => (
              <div key={i} className="relative w-12 h-12 rounded-lg overflow-hidden border border-olive/30">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => onRemoveExtraImage(i)}
                  aria-label="Remove"
                  className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
            {additionalImages.length < 3 && (
              <label className="px-3 py-2 rounded-xl bg-white border border-dashed border-olive/40 text-xs font-bold text-ink cursor-pointer flex items-center gap-1 hover:bg-olive/5">
                <Plus className="w-3.5 h-3.5 text-olive" />
                <span>
                  {addingExtra
                    ? locale === 'ur' ? 'شامل ہو رہا ہے...' : 'Adding...'
                    : locale === 'ur' ? 'اضافی تصویر شامل کریں' : 'Add Field Angle'}
                </span>
                <input type="file" accept="image/*" onChange={handleExtraFiles} className="hidden" />
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ConfidenceCalibrationPanel({
  diagnosis,
  reportLang,
}: {
  diagnosis: CropDiagnosis;
  reportLang: 'en' | 'ur';
}) {
  const cb = diagnosis.confidence_breakdown;
  if (!cb) return null;

  const modelPct = Math.round((cb.model_confidence || 0) * 100);
  const certaintyPct = Math.round((cb.diagnostic_certainty || 0) * 100);
  const altPct = Math.round((cb.alternative_top_probability || 0) * 100);

  return (
    <div className="bg-canvas/90 rounded-2xl p-3.5 border border-olive/15 space-y-2.5 text-xs text-start">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="font-black text-[11px] text-ink uppercase flex items-center gap-1.5">
          <FlaskConical className="w-3.5 h-3.5 text-olive" />
          <span>
            {reportLang === 'en'
              ? 'Calibrated Certainty & Laboratory Status'
              : 'موزوں تشخیصی یقین اور لیبارٹری حیثیت'}
          </span>
        </span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
          {reportLang === 'en' ? 'Unconfirmed Visual Screening Only' : 'صرف بصری معائنہ (غیر تصدیق شدہ لیب)'}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
        <div className="bg-white p-2 rounded-xl border border-olive/10">
          <span className="text-ink/55 block font-bold">
            {reportLang === 'en' ? 'Raw AI Score' : 'اے آئی سکور'}
          </span>
          <strong className="text-sm text-ink">{modelPct}%</strong>
        </div>
        <div className="bg-white p-2 rounded-xl border border-olive/10">
          <span className="text-ink/55 block font-bold">
            {reportLang === 'en' ? 'Calibrated Certainty' : 'حقیقی یقین'}
          </span>
          <strong className="text-sm text-emerald-700">{certaintyPct}%</strong>
        </div>
        <div className="bg-white p-2 rounded-xl border border-olive/10">
          <span className="text-ink/55 block font-bold">
            {reportLang === 'en' ? 'Visual Evidence' : 'تصویری شواہد'}
          </span>
          <strong className="text-sm capitalize text-ink">{cb.visual_evidence_quality}</strong>
        </div>
        <div className="bg-white p-2 rounded-xl border border-olive/10">
          <span className="text-ink/55 block font-bold">
            {reportLang === 'en' ? 'Alt. Possibility' : 'دوسرا امکان'}
          </span>
          <strong className="text-sm text-ink">{altPct > 0 ? `${altPct}%` : '—'}</strong>
        </div>
      </div>

      {cb.calibration_note && (
        <p className="text-[11px] text-ink/75 leading-relaxed">
          {getLocalizedText(cb.calibration_note, reportLang)}
        </p>
      )}

      {diagnosis.safety_guardrail_notes && diagnosis.safety_guardrail_notes.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-2.5 space-y-1 text-red-900">
          <div className="font-black text-[11px] flex items-center gap-1">
            <ShieldAlert className="w-3.5 h-3.5 text-red-600" />
            <span>
              {reportLang === 'en' ? 'Pesticide Safety Filter Applied' : 'زرعی زہروں کا حفاظتی فلٹر'}
            </span>
          </div>
          {diagnosis.safety_guardrail_notes.map((n, i) => (
            <p key={i} className="text-[11px] leading-snug">
              {getLocalizedText(n, reportLang)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function ExtendedAgronomyCards({
  diagnosis,
  reportLang,
}: {
  diagnosis: CropDiagnosis;
  reportLang: 'en' | 'ur';
}) {
  const handleDownloadReport = () => {
    const content = buildStructuredAgronomyReportText(diagnosis, reportLang);
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

  return (
    <div className="space-y-3 pt-1">
      {/* Disease Development, Yield & Quality Impact Grid */}
      {(diagnosis.disease_development_conditions || diagnosis.yield_impact || diagnosis.quality_risk) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
          {diagnosis.disease_development_conditions && (
            <div className="bg-sky-50/70 p-3 rounded-2xl border border-sky-200 space-y-1">
              <span className="text-[10px] font-black text-sky-900 uppercase block">
                {reportLang === 'en' ? 'Disease Development Conditions' : 'بیماری بڑھنے کے موسمی حالات'}
              </span>
              <p className="text-ink/85 leading-relaxed">
                {getLocalizedText(diagnosis.disease_development_conditions, reportLang)}
              </p>
            </div>
          )}
          {(diagnosis.yield_impact || diagnosis.quality_risk) && (
            <div className="bg-rose-50/60 p-3 rounded-2xl border border-rose-200 space-y-1">
              <span className="text-[10px] font-black text-rose-900 uppercase block">
                {reportLang === 'en' ? 'Yield & Harvest Quality Risk' : 'پیداوار اور معیار پر اثر'}
              </span>
              {diagnosis.yield_impact && (
                <p className="text-ink/85 leading-relaxed">
                  {getLocalizedText(diagnosis.yield_impact, reportLang)}
                </p>
              )}
              {diagnosis.quality_risk && (
                <p className="text-rose-950 font-semibold leading-relaxed">
                  {getLocalizedText(diagnosis.quality_risk, reportLang)}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Possible Co-infections */}
      {diagnosis.possible_co_infections && diagnosis.possible_co_infections.length > 0 && (
        <div className="bg-purple-50/60 p-3 rounded-2xl border border-purple-200 text-xs space-y-1">
          <span className="text-[10px] font-black text-purple-900 uppercase flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5 text-purple-700" />
            <span>
              {reportLang === 'en' ? 'Possible Co-Infections / Secondary Issues' : 'ممکنہ مشترکہ بیماریاں / ثانوی حملہ'}
            </span>
          </span>
          <ul className="space-y-1 text-ink/85">
            {diagnosis.possible_co_infections.map((co, i) => (
              <li key={i}>• {getLocalizedText(co, reportLang)}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Short-Term & Long-Term Management Pills */}
      {diagnosis.treatment_pillars &&
        ((diagnosis.treatment_pillars.short_term_management?.length || 0) > 0 ||
          (diagnosis.treatment_pillars.long_term_prevention?.length || 0) > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {diagnosis.treatment_pillars.short_term_management &&
              diagnosis.treatment_pillars.short_term_management.length > 0 && (
                <div className="bg-emerald-50/70 p-3 rounded-2xl border border-emerald-200 space-y-1">
                  <span className="text-[10px] font-black text-emerald-900 uppercase block">
                    {reportLang === 'en' ? 'Short-Term Management (Next Few Days)' : 'قلیل مدتی انتظام (آئندہ چند دن)'}
                  </span>
                  {diagnosis.treatment_pillars.short_term_management.map((st, i) => (
                    <p key={i} className="text-ink/85">• {getLocalizedText(st, reportLang)}</p>
                  ))}
                </div>
              )}
            {diagnosis.treatment_pillars.long_term_prevention &&
              diagnosis.treatment_pillars.long_term_prevention.length > 0 && (
                <div className="bg-amber-50/60 p-3 rounded-2xl border border-amber-200 space-y-1">
                  <span className="text-[10px] font-black text-amber-900 uppercase block">
                    {reportLang === 'en' ? 'Long-Term Prevention' : 'طویل مدتی بچاؤ'}
                  </span>
                  {diagnosis.treatment_pillars.long_term_prevention.map((lt, i) => (
                    <p key={i} className="text-ink/85">• {getLocalizedText(lt, reportLang)}</p>
                  ))}
                </div>
              )}
          </div>
        )}

      {/* Whole Field Multi-Photo Summary */}
      {diagnosis.field_assessment && diagnosis.field_assessment.mode === 'whole_field' && (
        <div className="bg-emerald-900/5 p-3.5 rounded-2xl border border-emerald-700/20 text-xs space-y-1">
          <span className="text-[10px] font-black text-emerald-900 uppercase block">
            {reportLang === 'en'
              ? `Whole-Field Multi-Photo Assessment (${diagnosis.field_assessment.images_analyzed} frames)`
              : `پورے کھیت کا مجموعی جائزہ (${diagnosis.field_assessment.images_analyzed} تصاویر)`}
          </span>
          <p className="text-ink/85 font-medium">
            {diagnosis.field_assessment.scope_summary
              ? getLocalizedText(diagnosis.field_assessment.scope_summary, reportLang)
              : diagnosis.field_assessment.distribution_pattern}
          </p>
        </div>
      )}

      {/* Additional Testing & Verified Sources */}
      {diagnosis.additional_testing_required && (
        <div className="bg-canvas/80 p-3 rounded-2xl border border-olive/15 text-xs space-y-1">
          <span className="text-[10px] font-black text-ink/70 uppercase block">
            {reportLang === 'en' ? 'Additional Testing Recommended' : 'مزید لیبارٹری یا فیلڈ ٹیسٹ'}
          </span>
          <p className="text-ink/80">{getLocalizedText(diagnosis.additional_testing_required, reportLang)}</p>
        </div>
      )}

      {diagnosis.scientific_references && diagnosis.scientific_references.length > 0 && (
        <div className="bg-canvas/70 p-3 rounded-2xl border border-olive/15 text-[11px] space-y-1.5">
          <span className="font-black text-ink/75 uppercase flex items-center gap-1">
            <BookOpen className="w-3.5 h-3.5 text-olive" />
            <span>
              {reportLang === 'en' ? 'Grounded Agricultural References' : 'مستند زرعی تحقیقی مراجع'}
            </span>
          </span>
          <ul className="space-y-1 text-ink/80">
            {diagnosis.scientific_references.map((ref, i) => (
              <li key={i} className="flex items-start justify-between gap-2">
                <span>
                  <strong>[{ref.source}]</strong> {ref.title}
                </span>
                {ref.url && (
                  <a
                    href={ref.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-olive font-bold flex-shrink-0 inline-flex items-center gap-0.5 hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Export 25-Point Report */}
      <button
        type="button"
        onClick={handleDownloadReport}
        className="w-full min-h-[44px] rounded-2xl bg-canvas hover:bg-olive/10 border border-olive/25 text-ink font-extrabold text-xs flex items-center justify-center gap-2 transition-all"
      >
        <Download className="w-4 h-4 text-olive" />
        <FileText className="w-4 h-4 text-olive" />
        <span>
          {reportLang === 'en'
            ? 'Download Full 25-Section Agronomy Report'
            : 'مکمل 25 نکاتی زرعی رپورٹ ڈاؤن لوڈ کریں'}
        </span>
      </button>
    </div>
  );
}

export function ScanFeedbackAndModelFooter({
  diagnosis,
  reportLang,
  region,
}: {
  diagnosis: CropDiagnosis;
  reportLang: 'en' | 'ur';
  region?: string;
}) {
  const [status, setStatus] = useState<'idle' | 'editing' | 'submitting' | 'submitted'>('idle');
  const [correctedDisease, setCorrectedDisease] = useState('');
  const [correctedCrop, setCorrectedCrop] = useState('');
  const [notes, setNotes] = useState('');
  const [consentForDataset, setConsentForDataset] = useState(false);
  const [serverMsg, setServerMsg] = useState('');

  const sendFeedback = async (verdict: 'correct' | 'incorrect') => {
    setStatus('submitting');
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
      setStatus('submitted');
    } catch {
      setStatus('idle');
    }
  };

  return (
    <div className="space-y-3 pt-2 border-t border-olive/10 text-start">
      <div className="bg-white rounded-2xl p-3.5 border border-olive/15 space-y-2.5 text-xs">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="font-black text-ink">
            {reportLang === 'en'
              ? 'Help Improve Zarkhez (Expert-Verified Queue)'
              : 'زرخیز کو بہتر بنائیں (ماہرِ زراعت کے جائزے کے لیے)'}
          </span>
          <span className="text-[10px] font-bold text-ink/55">
            {diagnosis.model_version || 'zarkhez-vision-v2.4-cloud'}
          </span>
        </div>

        {status === 'submitted' ? (
          <div className="flex items-center gap-2 text-emerald-800 bg-emerald-50 p-2.5 rounded-xl border border-emerald-200 font-semibold">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>{serverMsg}</span>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={status === 'submitting'}
                onClick={() => sendFeedback('correct')}
                className="flex-1 py-2 px-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 font-bold flex items-center justify-center gap-1.5"
              >
                <ThumbsUp className="w-3.5 h-3.5" />
                <span>{reportLang === 'en' ? 'Accurate Match' : 'تشخیص درست ہے'}</span>
              </button>
              <button
                type="button"
                disabled={status === 'submitting'}
                onClick={() => setStatus(status === 'editing' ? 'idle' : 'editing')}
                className="flex-1 py-2 px-3 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 font-bold flex items-center justify-center gap-1.5"
              >
                <ThumbsDown className="w-3.5 h-3.5" />
                <span>{reportLang === 'en' ? 'Suggest Correction' : 'درستگی تجویز کریں'}</span>
              </button>
            </div>

            {status === 'editing' && (
              <div className="space-y-2 pt-1">
                <input
                  type="text"
                  value={correctedCrop}
                  onChange={(e) => setCorrectedCrop(e.target.value)}
                  placeholder={reportLang === 'en' ? 'Actual crop (if different)' : 'درست فصل کا نام (اگر مختلف ہو)'}
                  className="w-full px-3 py-2 rounded-xl bg-canvas border border-olive/20 text-xs"
                />
                <input
                  type="text"
                  value={correctedDisease}
                  onChange={(e) => setCorrectedDisease(e.target.value)}
                  placeholder={reportLang === 'en' ? 'Confirmed disease / expert / lab finding' : 'ماہر یا لیب سے تصدیق شدہ بیماری'}
                  className="w-full px-3 py-2 rounded-xl bg-canvas border border-olive/20 text-xs"
                />
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder={reportLang === 'en' ? 'Additional field notes...' : 'اضافی تفصیل (اختیاری)'}
                  className="w-full px-3 py-2 rounded-xl bg-canvas border border-olive/20 text-xs"
                />
                <label className="flex items-start gap-2 text-[11px] text-ink/75 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={consentForDataset}
                    onChange={(e) => setConsentForDataset(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    {reportLang === 'en'
                      ? 'Consent to include this scan metadata for expert verification (quarantined until verified by an agronomist).'
                      : 'ماہرِ زراعت کی تصدیق کے بعد تحقیقی بہتری کے لیے محفوظ کرنے کی اجازت ہے۔'}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => sendFeedback('incorrect')}
                  className="w-full py-2 rounded-xl bg-[#062409] text-white font-black text-xs"
                >
                  {reportLang === 'en' ? 'Submit to Expert Review Queue' : 'ماہر کے جائزے کے لیے بھیجیں'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Explicit Scientific Limitations Footer */}
      <div className="bg-canvas/70 rounded-2xl p-3 border border-olive/15 text-[11px] text-ink/70 flex items-start gap-2">
        <ShieldCheck className="w-4 h-4 text-olive flex-shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          {reportLang === 'en'
            ? 'Scientific Limitation: Visual AI is never 100% certain. Microscopic pathogens, latent viruses, and chemical drift vs nutritional stress overlap visually and require field extension or lab testing.'
            : 'سائنسی وضاحت: بصری اے آئی سو فیصد یقینی نہیں ہوتا۔ خوردبینی جراثیم، مٹی کی نمکیات اور کیمیائی اثرات کے فرق کی حتمی تصدیق ماہرِ زراعت یا لیب ٹیسٹ سے کروائیں۔'}
        </p>
      </div>
    </div>
  );
}
