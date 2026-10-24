// spec-screen: S01
// 10 §4–§5 (form version 2026.1), Japanese: the short Label of each question id and the choice texts, for dialog item 25-2.
// Typed answers are shown as entered; choice codes are shown in Japanese (F2-04). Unknown ids / codes are shown as stored.
export const FORM_VERSIONS = ["2026.1"];

export const QUESTION_LABEL: Record<string, string> = {
  C01: "主訴", C02: "発症時期", C03: "服用中のお薬", C03a: "お薬の名前", C03b: "お薬手帳", C04: "アレルギー", C04a: "アレルギーの種類",
  C04b: "アレルギーの内容", C05: "既往歴", C05a: "既往歴の内容", C06: "妊娠", C06a: "妊娠週数", C07: "授乳", C08: "喫煙", C08a: "1日の本数",
  C09: "飲酒", C10: "紹介状", C11: "その他", IM01: "体温", IM02: "症状", IM03: "健診結果", PED01: "体温", PED02: "体重", PED03: "出生体重",
  PED04: "予防接種", PED04a: "未接種のワクチン", PED05: "発育・発達", PED05a: "指摘の内容", DER01: "症状の部位", DER02: "皮膚の症状",
  DER03: "使用したお薬", DER03a: "お薬の名前",
};

const YN = { YES: "はい", NO: "いいえ" };
const YN2 = { NONE: "ない", YES: "ある" };
export const CHOICES: Record<string, Record<string, string>> = {
  C02: { TODAY: "今日", D1_3: "1〜3日前", D4_6: "4〜6日前", W1_M1: "1週間以上、1か月未満", M1_PLUS: "1か月以上前", UNKNOWN: "はっきりしない" },
  C03: YN2, C03b: YN, C07: YN, C10: YN, IM03: YN, PED05: YN, DER03: YN2,
  C04: { NONE: "ない", YES: "ある", UNKNOWN: "わからない" },
  C04a: { DRUG: "お薬", FOOD: "食べ物", POLLEN: "花粉", LATEX: "ゴム（ラテックス）", METAL: "金属", OTHER: "その他" },
  C05: {
    NONE: "特になし", HYPERTENSION: "高血圧", DIABETES: "糖尿病", DYSLIPIDEMIA: "脂質異常症（コレステロールが高いなど）", ASTHMA: "ぜんそく",
    HEART: "心臓の病気", KIDNEY: "腎臓の病気", LIVER: "肝臓の病気", STROKE: "脳卒中（脳梗塞・脳出血など）", CANCER: "がん",
    ATOPIC: "アトピー性皮膚炎", SURGERY: "手術を受けたことがある", OTHER: "その他",
  },
  C06: { NO: "ない", PREGNANT: "妊娠中", POSSIBLE: "可能性がある", UNKNOWN: "わからない" },
  C08: { NEVER: "吸ったことがない", CURRENT: "吸っている", QUIT: "以前吸っていたが、やめた" },
  C09: { NONE: "飲まない", SOMETIMES: "ときどき飲む", DAILY: "ほぼ毎日飲む" },
  IM02: {
    FEVER: "発熱", COUGH: "せき", SPUTUM: "たん", THROAT: "のどの痛み", NOSE: "鼻水・鼻づまり", HEADACHE: "頭痛", ABDOMINAL: "腹痛",
    NAUSEA: "吐き気・嘔吐", DIARRHEA: "下痢", FATIGUE: "だるさ", OTHER: "その他",
  },
  PED04: { ALL: "受けている", PARTLY: "受けていないものがある", UNKNOWN: "わからない" },
  DER01: {
    HEAD: "頭（頭皮）", FACE: "顔", NECK: "首", CHEST_ABD: "胸・おなか", BACK: "背中", ARM: "腕・手", LEG: "脚・足", GENITAL: "陰部・おしり",
    NAIL: "爪", WHOLE: "全身",
  },
  DER02: {
    ITCH: "かゆみ", PAIN: "痛み", RED: "赤み", RASH: "ぶつぶつ・湿疹", BLISTER: "水ぶくれ", DRY: "かさつき・皮むけ", LUMP: "できもの・しこり",
    HAIR: "脱毛", OTHER: "その他",
  },
};

/** answers object (question id → string | number | string[]) → label / text pairs in the order of the object */
export function answerRows(answers: unknown): Array<{ id: string; question: string; answer: string }> {
  if (!answers || typeof answers !== "object") return [];
  return Object.entries(answers as Record<string, unknown>).map(([id, v]) => {
    const choices = CHOICES[id];
    const one = (x: unknown) => (choices && typeof x === "string" ? (choices[x] ?? x) : String(x));
    return { id, question: QUESTION_LABEL[id] ?? id, answer: Array.isArray(v) ? v.map(one).join("、") : one(v) };
  });
}
