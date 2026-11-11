import { CropDiagnosis, getLocalizedText } from '../schemas';

/**
 * Generates a structured 25-section agricultural diagnostic report (HTML / plain-text)
 * directly from grounded Zarkhez Cloud Vision fields and curated references.
 */
export function buildStructuredAgronomyReportText(
  d: CropDiagnosis,
  lang: 'en' | 'ur'
): string {
  const txt = (v: unknown, fallback = 'Not assessed / دستیاب نہیں'): string => {
    if (!v) return fallback;
    if (typeof v === 'string') return v.trim() || fallback;
    return getLocalizedText(v as Parameters<typeof getLocalizedText>[0], lang, fallback) || fallback;
  };

  const cb = d.confidence_breakdown;
  const modelPct = Math.round((cb?.model_confidence ?? d.identification_confidence ?? 0) * 100);
  const certPct = Math.round((cb?.diagnostic_certainty ?? d.identification_confidence ?? 0) * 100);
  const vi = d.visual_inspection;

  const sections: Array<[string, string]> = [
    [
      lang === 'en' ? '1. Crop Identification' : '1۔ فصل کی شناخت',
      `${lang === 'en' ? d.detected_crop : d.detected_crop_ur || d.detected_crop} (${d.crop_match ? (lang === 'en' ? 'Matched selection' : 'منتخب فصل سے مطابقت') : (lang === 'en' ? 'Mismatch noticed' : 'فصل مختلف')})`,
    ],
    [
      lang === 'en' ? '2. Plant Part / Object' : '2۔ متاثرہ حصہ / شے',
      lang === 'en' ? d.detected_plant_part : d.detected_plant_part_ur || d.detected_plant_part,
    ],
    [
      lang === 'en' ? '3. Growth Stage' : '3۔ بڑھوتری کا مرحلہ',
      lang === 'en' ? d.growth_stage : d.growth_stage_ur || d.growth_stage,
    ],
    [
      lang === 'en' ? '4. Overall Plant Health' : '4۔ پودے کی مجموعی صحت',
      lang === 'en' ? d.plant_condition : d.plant_condition_ur || d.plant_condition,
    ],
    [
      lang === 'en' ? '5. Primary Diagnosis' : '5۔ بنیادی تشخیص',
      txt(d.problem_name),
    ],
    [
      lang === 'en' ? '6. Problem & Disease Category' : '6۔ بیماری یا مسئلے کی قسم',
      `${d.problem_category || d.pathogen_type || 'unknown'} (${d.pathogen_type || 'unknown'})`,
    ],
    [
      lang === 'en' ? '7. Scientific Pathogen Name' : '7۔ سائنسی نام',
      d.scientific_name?.trim() || (lang === 'en' ? 'Not confirmed from photo alone' : 'صرف تصویر سے سائنسی تصدیق ممکن نہیں'),
    ],
    [
      lang === 'en' ? '8. Severity Level' : '8۔ شدت کی سطح',
      `${d.severity_level || d.severity} — ${txt(d.severity_explanation)}`,
    ],
    [
      lang === 'en' ? '9. Model Confidence' : '9۔ ماڈل سکور',
      d.inspection_source === 'offline_assessment' ? '0% (Offline)' : `${modelPct}%`,
    ],
    [
      lang === 'en' ? '10. Calibrated Diagnostic Certainty & Lab Status' : '10۔ تصدیق شدہ یقین اور لیب حیثیت',
      `${certPct}% (${d.confidence_category || 'moderate'}) | Evidence: ${cb?.visual_evidence_quality || 'moderate'} | Lab Status: ${cb?.lab_confirmation_status || 'unconfirmed_visual_screening'}`,
    ],
    [
      lang === 'en' ? '11. Visible Symptoms' : '11۔ ظاہری علامات',
      d.observed_symptoms?.length
        ? d.observed_symptoms.map((s) => `- ${txt(s)}`).join('\n')
        : txt(null),
    ],
    [
      lang === 'en' ? '12. Lesion Analysis' : '12۔ دھبوں اور زخموں کا تجزیہ',
      vi
        ? `Lesions: ${vi.lesion_detected ? 'Yes' : 'No'} | Count: ${vi.lesion_count} | Shape: ${vi.lesion_shape} | Colors: ${vi.lesion_colors.join(', ') || 'none'} | Margins: ${vi.lesion_margins} | Affected area: ${vi.affected_area_pct ?? 0}%`
        : txt(null),
    ],
    [
      lang === 'en' ? '13. Visual Evidence' : '13۔ بصری شواہد',
      txt(d.why_suspected),
    ],
    [
      lang === 'en' ? '14. Possible Causes' : '14۔ ممکنہ اسباب',
      d.possible_causes?.length ? d.possible_causes.map((c) => `- ${txt(c)}`).join('\n') : txt(null),
    ],
    [
      lang === 'en' ? '15. Disease Development Conditions' : '15۔ بیماری پھیلنے کے حالات',
      txt(d.disease_development_conditions),
    ],
    [
      lang === 'en' ? '16. Differential Diagnosis' : '16۔ ملتی جلتی بیماریوں کا تقابل',
      d.differential_diagnoses?.length
        ? d.differential_diagnoses
            .map((df) => `- ${df.name}: ${txt(df.differences)} (${txt(df.field_distinction_tip)})`)
            .join('\n')
        : txt(null),
    ],
    [
      lang === 'en' ? '17. Possible Co-infections' : '17۔ ممکنہ مشترکہ بیماریاں',
      d.possible_co_infections?.length
        ? d.possible_co_infections.map((co) => `- ${txt(co)}`).join('\n')
        : lang === 'en'
        ? 'No secondary co-infection clearly established.'
        : 'کوئی واضح ثانوی انفیکشن نظر نہیں آیا۔',
    ],
    [
      lang === 'en' ? '18. Impact on Crop Yield' : '18۔ پیداوار پر ممکنہ اثر',
      txt(d.yield_impact),
    ],
    [
      lang === 'en' ? '19. Risk to Grain / Fruit Quality' : '19۔ دانے یا پھل کے معیار کو خطرہ',
      txt(d.quality_risk),
    ],
    [
      lang === 'en' ? '20. Immediate Actions (Today)' : '20۔ فوری اقدامات (آج ہی کریں)',
      d.treatment_pillars?.immediate_actions?.length
        ? d.treatment_pillars.immediate_actions.map((a) => `- ${txt(a)}`).join('\n')
        : txt(null),
    ],
    [
      lang === 'en' ? '21. Short-Term & Treatment Recommendations' : '21۔ قلیل مدتی علاج اور محفوظ تجاویز',
      [
        ...(d.treatment_pillars?.short_term_management || []).map((s) => `- [Short-Term] ${txt(s)}`),
        ...(d.treatment_pillars?.cultural_management || []).map((s) => `- [Cultural] ${txt(s)}`),
        ...(d.treatment_pillars?.biological_management || []).map((s) => `- [Biological] ${txt(s)}`),
        ...(d.treatment_pillars?.chemical_management || []).map(
          (ch) => `- [Registered Active: ${ch.active_ingredient}] ${txt(ch.purpose)} — ${txt(ch.safety_precautions)}`
        ),
        ...(d.recommendations || []).map((r) => `- ${txt(r)}`),
      ].join('\n') || txt(null),
    ],
    [
      lang === 'en' ? '22. Prevention Strategies' : '22۔ حفاظتی حکمتِ عملی',
      [...(d.treatment_pillars?.long_term_prevention || []), ...(d.prevention || [])]
        .map((p) => `- ${txt(p)}`)
        .join('\n') || txt(null),
    ],
    [
      lang === 'en' ? '23. Next-Season Management' : '23۔ آئندہ فصل کا انتظام',
      d.prevention?.length ? d.prevention.map((p) => `- ${txt(p)}`).join('\n') : txt(null),
    ],
    [
      lang === 'en' ? '24. When to Consult an Expert' : '24۔ زرعی ماہر سے کب مشورہ کریں',
      txt(d.when_to_consult_expert),
    ],
    [
      lang === 'en' ? '25. Additional Testing Required' : '25۔ مزید لیبارٹری یا فیلڈ ٹیسٹ',
      txt(
        d.additional_testing_required,
        lang === 'en'
          ? 'Lab microscopy/culture or soil EC testing recommended if symptoms persist or economic spraying is planned.'
          : 'اگر علامات برقرار رہیں یا مہنگے سپرے کا فیصلہ کرنا ہو تو مٹی کا ٹیسٹ یا لیبارٹری معائنہ ضرور کروائیں۔'
      ),
    ],
  ];

  const refs = d.scientific_references?.length
    ? `\nREFERENCES:\n${d.scientific_references.map((r) => `- [${r.source}] ${r.title}${r.url ? ` (${r.url})` : ''}`).join('\n')}`
    : '';

  const header =
    lang === 'en'
      ? `ZARKHEZ CLOUD VISION — STRUCTURED AGRICULTURAL REPORT (${d.model_version || 'v2.4'})`
      : `زرخیز کلاؤڈ وژن — مکمل زرعی تشخیصی رپورٹ (${d.model_version || 'v2.4'})`;

  const footer =
    lang === 'en'
      ? 'LIMITATION NOTICE: Visual AI screening cannot guarantee 100% accuracy or replace lab diagnostics. Always verify pesticides with your district Agriculture Extension Officer.'
      : 'اہم وضاحت: بصری اے آئی تجزیہ 100 فیصد حتمی نہیں ہوتا اور نہ ہی لیبارٹری ٹیسٹ کا متبادل ہے۔ دوا کے استعمال سے قبل مقامی زرعی افسر سے تصدیق ضرور کریں۔';

  return `${header}\nGenerated: ${d.scan_timestamp || new Date().toISOString()}\n${'='.repeat(68)}\n\n${sections
    .map(([title, body]) => `${title}\n${body}`)
    .join('\n\n')}${refs}\n\n${'-'.repeat(68)}\n${footer}\n`;
}
