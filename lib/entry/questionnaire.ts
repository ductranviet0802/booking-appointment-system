// spec-screen: P12
// The web 問診 form version 2026.1 (docs/10-questionnaire.md, supplied by the customer): question set, conditions
// (§1.3), required flags, ranges, and the one check used by the screen (focus-out) and by the server (event 11, 11-3).
// Client-safe (no server imports). Answers JSON per 10 §6 note 1: text as typed, radio = code, check = codes, number =
// number; hidden questions and empty optional ones are left out.
import type { Lang } from "@/lib/i18n";

export const FORM_VERSION = "2026.1";

type L3 = [ja: string, en: string, vi: string];
export const tx = (l: L3, lang: Lang) => l[lang === "ja" ? 0 : lang === "en" ? 1 : 2];

export type Answers = Record<string, unknown>;
export type Person = { dept: string; sex: "MALE" | "FEMALE"; age: number };
export type Question = {
  id: string;
  label: L3;
  text: L3;
  type: "text" | "radio" | "check" | "number";
  max?: number;
  choices?: Array<[string, L3]>;
  range?: { min: number; max: number; decimals: 0 | 1; unit: L3 };
  /** yes = required; cond = required whenever shown (10 "cond.") */
  required: "yes" | "no" | "cond";
  /** C05a: required only when this holds */
  requiredIf?: (a: Answers) => boolean;
  dept?: string;
  when?: (p: Person) => boolean;
  /** follow-up: shown under the parent while this holds */
  parent?: string;
  open?: (a: Answers) => boolean;
  help?: L3;
  helpWhen?: (a: Answers) => boolean;
  /** helper line under the label (P12 item 28, image-only text) */
  hint?: L3;
  /** C05: this code cannot be combined with another */
  exclusive?: string;
};

const YES_NO: Array<[string, L3]> = [["YES", ["はい", "Yes", "Có"]], ["NO", ["いいえ", "No", "Không"]]];
const NONE_YES: Array<[string, L3]> = [["NONE", ["ない", "No", "Không"]], ["YES", ["ある", "Yes", "Có"]]];
const BRING: L3 = ["お持ちの方は受診日にご持参ください。", "If you have one, please bring it on the day of your visit.", "Nếu có, vui lòng mang theo vào ngày khám."];
const TEMP = { min: 34, max: 42, decimals: 1 as const, unit: ["℃", "°C", "°C"] as L3 };
const woman = (p: Person) => p.sex === "FEMALE" && p.age >= 12 && p.age <= 55;
const adult = (p: Person) => p.age >= 15;
const is = (id: string, code: string) => (a: Answers) => a[id] === code;
const has = (id: string, ...codes: string[]) => (a: Answers) => Array.isArray(a[id]) && (a[id] as string[]).some((c) => codes.includes(c));

const COMMON_HEAD: Question[] = [
  { id: "C01", label: ["主訴", "Main symptoms", "Triệu chứng chính"], type: "text", max: 200, required: "yes",
    text: ["本日はどのような症状で受診されますか。できるだけ具体的にご記入ください。", "What symptoms are you coming in for today? Please describe them as specifically as you can.", "Hôm nay bạn đến khám vì triệu chứng gì? Vui lòng mô tả càng cụ thể càng tốt."] },
  { id: "C02", label: ["発症時期", "Onset", "Thời điểm khởi phát"], type: "radio", required: "yes",
    text: ["その症状はいつ頃からですか。", "When did the symptoms start?", "Triệu chứng bắt đầu từ khi nào?"],
    choices: [
      ["TODAY", ["今日", "Today", "Hôm nay"]], ["D1_3", ["1〜3日前", "1–3 days ago", "1–3 ngày trước"]], ["D4_6", ["4〜6日前", "4–6 days ago", "4–6 ngày trước"]],
      ["W1_M1", ["1週間以上、1か月未満", "1 week to less than 1 month ago", "Từ 1 tuần đến dưới 1 tháng trước"]],
      ["M1_PLUS", ["1か月以上前", "1 month ago or longer", "Từ 1 tháng trước trở lên"]], ["UNKNOWN", ["はっきりしない", "Not sure", "Không rõ"]],
    ] },
];

const NAIKA: Question[] = [
  { id: "IM01", dept: "naika", label: ["体温", "Body temperature", "Nhiệt độ cơ thể"], type: "number", range: TEMP, required: "no",
    text: ["現在の体温をご記入ください（測っていない場合は空欄で結構です）。", "Please enter your current body temperature (leave blank if you have not measured it).", "Vui lòng nhập nhiệt độ cơ thể hiện tại (để trống nếu chưa đo)."] },
  { id: "IM02", dept: "naika", label: ["症状", "Symptoms", "Triệu chứng"], type: "check", required: "no",
    text: ["当てはまる症状があれば選んでください（複数選択可）。", "Select any symptoms you have. (Select all that apply.)", "Vui lòng chọn các triệu chứng bạn đang có. (Có thể chọn nhiều.)"],
    choices: [
      ["FEVER", ["発熱", "Fever", "Sốt"]], ["COUGH", ["せき", "Cough", "Ho"]], ["SPUTUM", ["たん", "Phlegm", "Đờm"]], ["THROAT", ["のどの痛み", "Sore throat", "Đau họng"]],
      ["NOSE", ["鼻水・鼻づまり", "Runny or blocked nose", "Sổ mũi, nghẹt mũi"]], ["HEADACHE", ["頭痛", "Headache", "Đau đầu"]], ["ABDOMINAL", ["腹痛", "Stomach ache", "Đau bụng"]],
      ["NAUSEA", ["吐き気・嘔吐", "Nausea or vomiting", "Buồn nôn, nôn"]], ["DIARRHEA", ["下痢", "Diarrhea", "Tiêu chảy"]], ["FATIGUE", ["だるさ", "Tiredness", "Mệt mỏi"]],
      ["OTHER", ["その他", "Other", "Khác"]],
    ] },
  { id: "IM03", dept: "naika", label: ["健診結果", "Check-up results", "Kết quả khám sức khỏe"], type: "radio", choices: YES_NO, required: "yes",
    text: ["健康診断や人間ドックで異常を指摘され、そのご相談で受診されますか。", "Are you coming to discuss abnormal results from a health check-up?", "Bạn đến khám để được tư vấn về kết quả bất thường trong lần khám sức khỏe phải không?"],
    help: ["結果の用紙を受診日にご持参ください。", "Please bring the result sheet on the day of your visit.", "Vui lòng mang theo phiếu kết quả vào ngày khám."], helpWhen: is("IM03", "YES") },
];

const SHONIKA: Question[] = [
  { id: "PED01", dept: "shonika", label: ["体温", "Body temperature", "Nhiệt độ cơ thể"], type: "number", range: TEMP, required: "no",
    text: ["現在の体温をご記入ください（測っていない場合は空欄で結構です）。", "Please enter the current body temperature (leave blank if it has not been measured).", "Vui lòng nhập nhiệt độ cơ thể hiện tại (để trống nếu chưa đo)."] },
  { id: "PED02", dept: "shonika", label: ["体重", "Body weight", "Cân nặng"], type: "number", range: { min: 1, max: 150, decimals: 1, unit: ["kg", "kg", "kg"] }, required: "yes",
    text: ["現在の体重をご記入ください（おおよそで結構です）。", "Please enter the current body weight (an approximate value is fine).", "Vui lòng nhập cân nặng hiện tại (số gần đúng cũng được)."] },
  // range 300–6000 of 10 §5.2 / P12 §4.1 / §6 9-1; P12 §4.2 row 11 says 500 (質疑 drafted in the W3 report)
  { id: "PED03", dept: "shonika", when: (p) => p.age <= 5, label: ["出生体重", "Birth weight", "Cân nặng lúc sinh"], type: "number",
    range: { min: 300, max: 6000, decimals: 0, unit: ["g", "g", "g"] }, required: "no",
    text: ["生まれたときの体重をご記入ください（わかれば）。", "Please enter the birth weight (if known).", "Vui lòng nhập cân nặng lúc sinh (nếu biết)."] },
  { id: "PED04", dept: "shonika", label: ["予防接種", "Vaccinations", "Tiêm chủng"], type: "radio", required: "yes",
    text: ["予防接種は年齢に応じて受けていますか。", "Are the vaccinations up to date for the age?", "Đã tiêm chủng đầy đủ theo độ tuổi chưa?"],
    choices: [["ALL", ["受けている", "Yes, up to date", "Đã tiêm đầy đủ"]], ["PARTLY", ["受けていないものがある", "Some are missing", "Còn thiếu một số mũi"]], ["UNKNOWN", ["わからない", "Not sure", "Không rõ"]]],
    help: ["母子健康手帳をお持ちの方は受診日にご持参ください。", "If you have the Maternal and Child Health Handbook, please bring it on the day of the visit.", "Nếu có Sổ tay sức khỏe mẹ và bé, vui lòng mang theo vào ngày khám."] },
  { id: "PED04a", parent: "PED04", open: is("PED04", "PARTLY"), label: ["未接種のワクチン", "Missing vaccinations", "Mũi tiêm còn thiếu"], type: "text", max: 100, required: "no",
    text: ["まだ受けていない予防接種がわかればご記入ください。", "If you know which vaccinations are missing, please enter them.", "Nếu biết mũi tiêm nào còn thiếu, vui lòng ghi rõ."] },
  { id: "PED05", dept: "shonika", label: ["発育・発達", "Growth and development", "Tăng trưởng và phát triển"], type: "radio", choices: YES_NO, required: "no",
    text: ["これまでに、発育や発達について指摘を受けたことはありますか。", "Has anyone ever raised a concern about growth or development?", "Đã từng có ai nhận xét về vấn đề tăng trưởng hoặc phát triển chưa?"] },
  { id: "PED05a", parent: "PED05", open: is("PED05", "YES"), label: ["指摘の内容", "Details", "Chi tiết"], type: "text", max: 100, required: "no",
    text: ["指摘された内容と、指摘を受けた場所（健診など）をご記入ください。", "Please enter what was pointed out and where (e.g. at a health check-up).", "Vui lòng ghi nội dung được nhận xét và nơi nhận xét (ví dụ: khi khám sức khỏe)."] },
];

const HIFUKA: Question[] = [
  { id: "DER01", dept: "hifuka", label: ["症状の部位", "Affected area", "Vị trí triệu chứng"], type: "check", required: "yes",
    text: ["症状のある部位を選んでください（複数選択可）。", "Where are the symptoms? (Select all that apply.)", "Triệu chứng xuất hiện ở vị trí nào? (Có thể chọn nhiều.)"],
    choices: [
      ["HEAD", ["頭（頭皮）", "Head (scalp)", "Đầu (da đầu)"]], ["FACE", ["顔", "Face", "Mặt"]], ["NECK", ["首", "Neck", "Cổ"]], ["CHEST_ABD", ["胸・おなか", "Chest or abdomen", "Ngực, bụng"]],
      ["BACK", ["背中", "Back", "Lưng"]], ["ARM", ["腕・手", "Arms or hands", "Cánh tay, bàn tay"]], ["LEG", ["脚・足", "Legs or feet", "Chân, bàn chân"]],
      ["GENITAL", ["陰部・おしり", "Genital area or buttocks", "Vùng kín, mông"]], ["NAIL", ["爪", "Nails", "Móng"]], ["WHOLE", ["全身", "All over the body", "Toàn thân"]],
    ] },
  { id: "DER02", dept: "hifuka", label: ["皮膚の症状", "Skin symptoms", "Triệu chứng ngoài da"], type: "check", required: "yes",
    text: ["どのような症状ですか（複数選択可）。", "What are the symptoms like? (Select all that apply.)", "Triệu chứng như thế nào? (Có thể chọn nhiều.)"],
    choices: [
      ["ITCH", ["かゆみ", "Itching", "Ngứa"]], ["PAIN", ["痛み", "Pain", "Đau"]], ["RED", ["赤み", "Redness", "Mẩn đỏ"]], ["RASH", ["ぶつぶつ・湿疹", "Bumps or rash", "Nổi mẩn, chàm"]],
      ["BLISTER", ["水ぶくれ", "Blisters", "Mụn nước"]], ["DRY", ["かさつき・皮むけ", "Dryness or peeling", "Khô, bong tróc da"]],
      ["LUMP", ["できもの・しこり", "Lump or growth", "Mụn nhọt, cục u nhỏ"]], ["HAIR", ["脱毛", "Hair loss", "Rụng tóc"]], ["OTHER", ["その他", "Other", "Khác"]],
    ] },
  { id: "DER03", dept: "hifuka", label: ["使用したお薬", "Medicines used", "Thuốc đã dùng"], type: "radio", choices: NONE_YES, required: "yes",
    text: ["この症状に対して、すでに使ったお薬（塗り薬・市販薬を含む）はありますか。", "Have you already used any medicine for these symptoms (including creams and over-the-counter products)?", "Bạn đã dùng thuốc nào cho triệu chứng này chưa (kể cả thuốc bôi và thuốc không kê đơn)?"] },
  { id: "DER03a", parent: "DER03", open: is("DER03", "YES"), label: ["お薬の名前", "Medicine names", "Tên thuốc"], type: "text", max: 100, required: "no",
    text: ["お薬の名前と、使ってみてどうだったかをご記入ください。", "Please enter the name of the medicine and whether it helped.", "Vui lòng ghi tên thuốc và cho biết thuốc có hiệu quả không."] },
];

const COMMON_TAIL: Question[] = [
  { id: "C03", label: ["服用中のお薬", "Current medicines", "Thuốc đang dùng"], type: "radio", choices: NONE_YES, required: "yes",
    text: ["現在、服用中のお薬（市販薬・サプリメントを含む）はありますか。", "Are you currently taking any medicines (including over-the-counter medicines and supplements)?", "Hiện tại bạn có đang dùng thuốc nào không (kể cả thuốc không kê đơn và thực phẩm chức năng)?"] },
  { id: "C03a", parent: "C03", open: is("C03", "YES"), label: ["お薬の名前", "Medicine names", "Tên thuốc"], type: "text", max: 200, required: "cond",
    text: ["お薬の名前をご記入ください（わかる範囲で結構です）。", "Please enter the names of the medicines (as far as you know).", "Vui lòng ghi tên thuốc (trong phạm vi bạn biết)."] },
  { id: "C03b", parent: "C03", open: is("C03", "YES"), label: ["お薬手帳", "Medication record book", "Sổ theo dõi thuốc"], type: "radio", choices: YES_NO, required: "no",
    text: ["お薬手帳をお持ちですか。", "Do you have an okusuri techō (medication record book)?", "Bạn có sổ theo dõi thuốc (okusuri techō) không?"], help: BRING },
  { id: "C04", label: ["アレルギー", "Allergies", "Dị ứng"], type: "radio", required: "yes",
    text: ["アレルギーはありますか（お薬・食べ物など）。", "Do you have any allergies (to medicines, foods, etc.)?", "Bạn có bị dị ứng không (với thuốc, thức ăn, v.v.)?"],
    choices: [["NONE", ["ない", "No", "Không"]], ["YES", ["ある", "Yes", "Có"]], ["UNKNOWN", ["わからない", "Not sure", "Không rõ"]]] },
  { id: "C04a", parent: "C04", open: is("C04", "YES"), label: ["アレルギーの種類", "Allergy type", "Loại dị ứng"], type: "check", required: "cond",
    text: ["何に対するアレルギーですか（複数選択可）。", "What are you allergic to? (Select all that apply.)", "Bạn bị dị ứng với gì? (Có thể chọn nhiều.)"],
    choices: [
      ["DRUG", ["お薬", "Medicines", "Thuốc"]], ["FOOD", ["食べ物", "Foods", "Thức ăn"]], ["POLLEN", ["花粉", "Pollen", "Phấn hoa"]],
      ["LATEX", ["ゴム（ラテックス）", "Rubber (latex)", "Cao su (latex)"]], ["METAL", ["金属", "Metal", "Kim loại"]], ["OTHER", ["その他", "Other", "Khác"]],
    ] },
  { id: "C04b", parent: "C04", open: is("C04", "YES"), label: ["アレルギーの内容", "Allergy details", "Chi tiết dị ứng"], type: "text", max: 200, required: "cond",
    text: ["原因となるものの名前と、そのとき出た症状をご記入ください。", "Please enter what you are allergic to and what reaction you had.", "Vui lòng ghi tên chất gây dị ứng và triệu chứng đã gặp."] },
  { id: "C05", label: ["既往歴", "Medical history", "Tiền sử bệnh"], type: "check", required: "yes", exclusive: "NONE",
    text: ["これまでにかかった病気や、現在治療中の病気はありますか（複数選択可）。", "Have you had, or are you being treated for, any of the following? (Select all that apply.)", "Bạn đã từng mắc hoặc đang điều trị bệnh nào sau đây không? (Có thể chọn nhiều.)"],
    choices: [
      ["NONE", ["特になし", "None", "Không có"]], ["HYPERTENSION", ["高血圧", "High blood pressure", "Tăng huyết áp"]], ["DIABETES", ["糖尿病", "Diabetes", "Đái tháo đường"]],
      ["DYSLIPIDEMIA", ["脂質異常症（コレステロールが高いなど）", "High cholesterol or blood fats", "Rối loạn mỡ máu (cholesterol cao, v.v.)"]], ["ASTHMA", ["ぜんそく", "Asthma", "Hen suyễn"]],
      ["HEART", ["心臓の病気", "Heart disease", "Bệnh tim"]], ["KIDNEY", ["腎臓の病気", "Kidney disease", "Bệnh thận"]], ["LIVER", ["肝臓の病気", "Liver disease", "Bệnh gan"]],
      ["STROKE", ["脳卒中（脳梗塞・脳出血など）", "Stroke", "Đột quỵ (nhồi máu não, xuất huyết não, v.v.)"]], ["CANCER", ["がん", "Cancer", "Ung thư"]],
      ["ATOPIC", ["アトピー性皮膚炎", "Atopic dermatitis (eczema)", "Viêm da cơ địa"]], ["SURGERY", ["手術を受けたことがある", "I have had surgery", "Đã từng phẫu thuật"]], ["OTHER", ["その他", "Other", "Khác"]],
    ] },
  { id: "C05a", parent: "C05", open: (a) => Array.isArray(a.C05) && (a.C05 as string[]).some((c) => c !== "NONE"), label: ["既往歴の内容", "History details", "Chi tiết tiền sử"],
    type: "text", max: 200, required: "no", requiredIf: has("C05", "OTHER", "SURGERY"),
    hint: ["「手術」「その他」を選んだ場合は必須", "Required if you chose \"surgery\" or \"other\"", "Bắt buộc nếu bạn chọn \"phẫu thuật\" hoặc \"khác\""], // en / vi draft (P12 Q8)
    text: ["病名、かかった時期、受けた手術などをご記入ください。", "Please enter the illness, when you had it, and any surgery.", "Vui lòng ghi tên bệnh, thời gian mắc và phẫu thuật đã trải qua (nếu có)."] },
  { id: "C06", when: woman, label: ["妊娠", "Pregnancy", "Mang thai"], type: "radio", required: "cond",
    text: ["現在、妊娠中、または妊娠している可能性はありますか。", "Are you pregnant, or could you be pregnant?", "Hiện tại bạn có đang mang thai hoặc có khả năng mang thai không?"],
    choices: [["NO", ["ない", "No", "Không"]], ["PREGNANT", ["妊娠中", "I am pregnant", "Đang mang thai"]], ["POSSIBLE", ["可能性がある", "Possibly", "Có thể"]], ["UNKNOWN", ["わからない", "Not sure", "Không rõ"]]] },
  { id: "C06a", parent: "C06", open: is("C06", "PREGNANT"), label: ["妊娠週数", "Weeks of pregnancy", "Số tuần thai"], type: "number", required: "no",
    range: { min: 1, max: 42, decimals: 0, unit: ["週", "weeks", "tuần"] },
    text: ["妊娠何週目ですか（わかれば）。", "How many weeks pregnant are you (if known)?", "Bạn đang mang thai bao nhiêu tuần (nếu biết)?"] },
  { id: "C07", when: woman, label: ["授乳", "Breastfeeding", "Cho con bú"], type: "radio", choices: YES_NO, required: "cond",
    text: ["現在、授乳中ですか。", "Are you currently breastfeeding?", "Hiện tại bạn có đang cho con bú không?"] },
  { id: "C08", when: adult, label: ["喫煙", "Smoking", "Hút thuốc"], type: "radio", required: "cond",
    text: ["たばこを吸いますか（加熱式たばこ・電子たばこを含む）。", "Do you smoke (including heated tobacco and e-cigarettes)?", "Bạn có hút thuốc lá không (kể cả thuốc lá làm nóng và thuốc lá điện tử)?"],
    choices: [["NEVER", ["吸ったことがない", "Never", "Chưa từng hút"]], ["CURRENT", ["吸っている", "Yes, I smoke", "Đang hút"]], ["QUIT", ["以前吸っていたが、やめた", "I used to, but quit", "Trước đây có hút, nay đã bỏ"]]] },
  { id: "C08a", parent: "C08", open: is("C08", "CURRENT"), label: ["1日の本数", "Cigarettes per day", "Số điếu mỗi ngày"], type: "number", required: "no",
    range: { min: 1, max: 100, decimals: 0, unit: ["本", "per day", "điếu"] },
    text: ["1日に何本くらい吸いますか。", "About how many do you smoke a day?", "Mỗi ngày bạn hút khoảng bao nhiêu điếu?"] },
  { id: "C09", when: adult, label: ["飲酒", "Alcohol", "Rượu bia"], type: "radio", required: "cond",
    text: ["お酒を飲みますか。", "Do you drink alcohol?", "Bạn có uống rượu bia không?"],
    choices: [["NONE", ["飲まない", "No", "Không uống"]], ["SOMETIMES", ["ときどき飲む", "Occasionally", "Thỉnh thoảng"]], ["DAILY", ["ほぼ毎日飲む", "Almost every day", "Gần như hằng ngày"]]] },
  { id: "C10", label: ["紹介状", "Referral letter", "Giấy giới thiệu"], type: "radio", choices: YES_NO, required: "yes", help: BRING,
    text: ["他の医療機関からの紹介状をお持ちですか。", "Do you have a referral letter from another clinic or hospital?", "Bạn có giấy giới thiệu từ cơ sở y tế khác không?"] },
  { id: "C11", label: ["その他", "Other information", "Thông tin khác"], type: "text", max: 400, required: "no",
    text: ["その他、医師に伝えておきたいことがあればご記入ください。", "Is there anything else you would like the doctor to know?", "Bạn có điều gì khác muốn bác sĩ biết không?"] },
];

export const QUESTIONS: Question[] = [...COMMON_HEAD, ...NAIKA, ...SHONIKA, ...HIFUKA, ...COMMON_TAIL];
const byId = new Map(QUESTIONS.map((q) => [q.id, q]));

/** 満年齢 on the visit date (10 §1.3: up on the birthday) */
export function ageOn(birthIso: string, visitIso: string) {
  const years = Number(visitIso.slice(0, 4)) - Number(birthIso.slice(0, 4));
  return visitIso.slice(5) >= birthIso.slice(5) ? years : years - 1;
}

/** the questions shown for the person and the answers (10 §1.3, §3 order); follow-ups only while their parent opens them */
export function shownQuestions(p: Person, a: Answers): Question[] {
  return QUESTIONS.filter((q) => {
    if (q.parent) return shownTop(byId.get(q.parent)!, p) && !!q.open?.(a);
    return shownTop(q, p);
  });
}
const shownTop = (q: Question, p: Person) => (!q.dept || q.dept === p.dept) && (!q.when || q.when(p));

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.replace(/[\s　]/g, "") === "") || (Array.isArray(v) && v.length === 0);

export const isRequired = (q: Question, a: Answers) => q.required !== "no" || !!q.requiredIf?.(a);

export type QError = { field: string; code: "PE001" | "PE002" | "PE003" | "PE038"; params?: Record<string, string | number> };

const numberPattern = (decimals: 0 | 1) => (decimals === 1 ? /^\d+(\.\d)?$/ : /^\d+$/);
export const rangeText = (n: number, decimals: 0 | 1) => n.toFixed(decimals);

/** one question: its error, or its stored value (undefined = left out of the JSON) */
export function checkOne(q: Question, a: Answers): { error: QError | null; value: unknown } {
  const v = a[q.id];
  const err = (code: QError["code"], params?: QError["params"]) => ({ error: { field: q.id, code, ...(params && { params }) }, value: undefined });
  if (blank(v)) return isRequired(q, a) ? err("PE001") : { error: null, value: undefined };
  if (q.type === "text") {
    if (typeof v !== "string") return err("PE002");
    return [...v].length > q.max! ? err("PE003", { n: q.max! }) : { error: null, value: v };
  }
  const codes = new Set(q.choices?.map(([c]) => c));
  if (q.type === "radio") return typeof v === "string" && codes.has(v) ? { error: null, value: v } : err("PE002");
  if (q.type === "check") {
    const list = v as unknown[];
    const ok = Array.isArray(v) && list.every((c) => typeof c === "string" && codes.has(c)) && new Set(list).size === list.length &&
      !(q.exclusive && list.includes(q.exclusive) && list.length > 1);
    return ok ? { error: null, value: list } : err("PE002"); // tampered code / NONE with another code (Q11 A)
  }
  const r = q.range!;
  const s = typeof v === "number" ? String(v) : v;
  if (typeof s !== "string" || !numberPattern(r.decimals).test(s)) return err("PE002"); // Q6 A
  const n = Number(s);
  if (n < r.min || n > r.max) {
    const lo = rangeText(r.min, r.decimals);
    const hi = rangeText(r.max, r.decimals);
    return err("PE038", { 最小: lo, 最大: hi, min: lo, max: hi });
  }
  return { error: null, value: n };
}

/** event 11 (11-3): every shown question checked again; hidden ones dropped silently (Q11 A) */
export function checkAnswers(p: Person, raw: Answers): { answers: Answers; errors: QError[] } {
  const answers: Answers = {};
  const errors: QError[] = [];
  for (const q of shownQuestions(p, raw)) {
    const r = checkOne(q, raw);
    if (r.error) errors.push(r.error);
    else if (r.value !== undefined) answers[q.id] = r.value;
  }
  return { answers, errors };
}

/** what 戻る keeps (event 12): the valid answers of the shown questions, without the required checks */
export function keepAnswers(p: Person, raw: Answers): Answers {
  const out: Answers = {};
  for (const q of shownQuestions(p, raw)) {
    const r = checkOne({ ...q, required: "no", requiredIf: undefined }, raw);
    if (!r.error && r.value !== undefined) out[q.id] = r.value;
  }
  return out;
}

/** 回答状況 (item 40, Q4 A): top-level questions shown, and those with an answer (optional ones included) */
export function progressOf(p: Person, a: Answers) {
  const top = shownQuestions(p, a).filter((q) => !q.parent);
  return { done: top.filter((q) => !blank(a[q.id])).length, total: top.length };
}

/** 次へ enabled (item 38, Q14 A): every shown required answer set */
export const requiredSet = (p: Person, a: Answers) => shownQuestions(p, a).every((q) => !isRequired(q, a) || !blank(a[q.id]));
