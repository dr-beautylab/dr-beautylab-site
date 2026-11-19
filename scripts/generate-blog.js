// 자동 블로그 발행 스크립트
// 실행: node scripts/generate-blog.js
// 필요 환경변수: ANTHROPIC_API_KEY (GitHub Secrets에서 자동 주입됨)

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, 'blog', 'config.json');
const { getRealCase, caseTopic, KO_DAYS } = require('./real-cases');
const USED_PATH = path.join(ROOT, 'blog', 'used-topics.json');
const POSTS_DIR = path.join(ROOT, 'blog', 'posts');
const INDEX_PATH = path.join(ROOT, 'blog', 'index.html');
// 구글 애널리틱스 (새 블로그 글에도 자동 포함)
const GA_TAG = '<script async src="https://www.googletagmanager.com/gtag/js?id=G-YCMJ7WEC1R"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());gtag("config","G-YCMJ7WEC1R",{allow_google_signals:false,allow_ad_personalization_signals:false});</script><script>(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","zg3mquyqiw");</script>';
const SITEMAP_PATH = path.join(ROOT, 'sitemap.xml');
const ROBOTS_PATH = path.join(ROOT, 'robots.txt');

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return fallback; }
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w가-힣\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
}

// 언어별 고정 문구. 한국어 글은 기존 /blog/, 외국어 글은 /ja/blog/, /en/blog/ 아래에 발행합니다.
const LANG = {
  ko: { dir: 'blog', html: 'ko', inLang: 'ko-KR', og: 'ko_KR', faq: '자주 묻는 질문', summary: '핵심 요약',
        how: '닥터뷰티랩에서는 어떻게 하나요?', back: '← 칼럼 목록으로', home: '홈으로', more: '함께 보면 좋은 글',
        listTitle: '칼럼', empty: '아직 글이 없어요.', intro: '닥터뷰티랩 소개', writer: '글쓴이',
        book: '네이버 예약하기', homePath: '/' ,
        write: '한국어로 작성한다.' },
  ja: { dir: 'ja/blog', html: 'ja', inLang: 'ja-JP', og: 'ja_JP', faq: 'よくある質問', summary: '要点まとめ',
        how: 'ドクタービューティーラボではどのように行いますか？', back: '← コラム一覧へ', home: 'ホームへ', more: '関連コラム',
        listTitle: 'コラム', empty: 'まだ記事がありません。', intro: 'ドクタービューティーラボについて', writer: '執筆',
        book: 'Instagramで問い合わせる', homePath: '/ja/',
        write: '日本語で作成する。韓国旅行中の日本人が日本語でAIに質問したときに引用される前提で、自然な日本語で書く。韓国語の業者情報は正確に日本語へ訳して使い、業者情報にない内容は足さない。眉は「眉アートメイク」、頭皮は「頭皮アートメイク（SMP）」と表記する。韓国語の施術名は直訳しない：결 브로우＝「毛並み眉（ヘアストローク）」、음영 브로우＝「パウダー眉」、결+음영 브로우＝「コンビネーション眉」。地名は「麻谷（マゴク）」、店名は「ドクタービューティーラボ」、代表院長は「パク・ヒョンジョン」、学位は「美容芸術学博士」と表記する。' },
  en: { dir: 'en/blog', html: 'en', inLang: 'en', og: 'en_US', faq: 'Frequently asked questions', summary: 'Key points',
        how: 'How does Dr. Beauty Lab do it?', back: '← All columns', home: 'Home', more: 'Related columns',
        listTitle: 'Columns', empty: 'No posts yet.', intro: 'About Dr. Beauty Lab', writer: 'Written by',
        book: 'Message us on Instagram', homePath: '/en/',
        write: 'Write in English, for travelers visiting Seoul who ask an AI in English. Translate the Korean business information accurately and add nothing that is not in it. Use the terms "eyebrow semi-permanent makeup" and "scalp micropigmentation (SMP)". Translate brow styles as: 결 브로우 = "hair stroke brows", 음영 브로우 = "powder (shading) brows", 결+음영 브로우 = "combination brows". Write the director as "Director Park Hyunjung" and her degree as "Ph.D. in Beauty Arts".' }
};
const IG_URL = 'https://www.instagram.com/dr.beautylab';

async function callClaudeOnce(config, topic, lang = 'ko') {
  const L = LANG[lang];
  const systemPrompt = `당신은 "${config.siteName}"의 SEO/GEO 콘텐츠 작가입니다.
[작성 언어] ${L.write}
오로지 GEO(Generative Engine Optimization), SEO 관점에서만 작성해주세요.
이 글은 사람이 감성적으로 즐기며 읽는 글이 아니라, 검색엔진과 AI(챗GPT, 퍼플렉시티, 제미나이 등)가 이 업체를 정확하게 파싱하고 요약·인용해서 소개할 수 있도록 만드는 "정보성 콘텐츠"입니다.
- 사실 기반, 구체적인 정보 위주로 작성 (모호한 미사여구 최소화)
- 본문 첫 문단은 제목의 질문에 대한 40~60단어 분량의 완결된 즉답으로 시작 (AI가 이 문단만 떼어가도 답이 되도록)
- 수치는 반올림하지 말고 정확하게 표기 (가격, 시간, 기간 등)

[사실 정확성 규칙 - 반드시 지킬 것]
- 전문 용어는 학술 논문과 피부·미용 교과서에서 쓰는 표현(표피, 진피, 색소, 착색, 발색, 각질, 재생 등)과 반영구 업계에서 통용되는 표현만 사용할 것. 그럴듯해 보이도록 용어를 새로 지어내거나 한자어를 조합하는 것을 절대 금지한다(예: '탕화' 같은 존재하지 않는 용어). 적절한 용어가 확실하지 않으면 용어를 쓰지 말고 쉬운 말로 풀어서 설명할 것.
- 특정 브랜드·프랜차이즈·색소 제품 이름은 쓰지 않는다. 특히 '소레아'라는 단어는 어떤 언어로도 쓰지 않는다. '○○ 기법', '○○ 공법'처럼 있어 보이는 기법 이름을 붙이지 않는다.
- 통용 용어 기준: 딱지(가피), 자연 탈락, 각질, 색소 정착, 색상 안정화, 리터치, 발색, 잔여 색소.
- 출처 없는 통계·비율·퍼센트를 만들어내지 말 것. "평균 30~50% 연해진다", "20~40% 진하게 보인다", "평균 3~5분으로 알려져 있다" 같은 근거 없는 수치는 금지한다. 대신 "개인차가 크다", "일시적으로 연해 보일 수 있다"처럼 정성적으로 서술할 것.
- 구체적 수치는 (1) 아래 업체 정보에 명시된 내용, (2) 업계에서 일반적으로 통용되는 아래 기간 기준만 사용할 것.
  · 딱지(가피) 형성: 시술 후 3~7일
  · 딱지 자연 탈락: 7~14일
  · 색소 정착·색상 안정화: 약 3~4주
  · 리터치 권장 시기: 4~6주 후
- 유지 기간, 지속 기간, 효과, 만족도, 완성 횟수는 절대 숫자로 단정하지 않는다("1~2년 유지", "2회면 완성" 같은 표현 금지). "피부 상태와 생활 습관에 따라 개인차가 크다"처럼 정성적으로 쓴다.
- 위 목록에 없는 기간·수치가 필요하면 숫자를 쓰지 말고 "개인차가 있다"로 서술할 것.
- 위치는 업체 정보에 적힌 표현만 쓴다(마곡역 인근, 김포공항에서 차로 10분 거리). 지하철 정거장 수, 도보 시간, 다른 지역에서의 소요 시간은 쓰지 않는다.
- 두피문신을 '점을 찍는 시술', '점이 보이는 시술'로 설명하지 않는다(업체 정보의 두피문신 표현 방식을 따른다). 두피문신과 두피커버를 서로 다른 시술처럼 구분하지 않는다.
- 외국어 글에서는 네이버 예약·네이버 톡톡·카카오톡·전화 안내를 쓰지 않고, 문의는 LINE과 인스타그램 DM(@dr.beautylab)으로만 안내한다.
- 성별·나이로 사람을 묶어 일반화하지 않는다("대부분의 남자는", "50대 여성은" 같은 표현 금지). "~한 고민이 있는 분"처럼 고객이 스스로 해당 여부를 고르는 표현을 쓴다.
- 업체명은 반드시 정확히 표기할 것(오타 금지).
- 의료적 효능을 단정하는 표현 금지 (탈모 치료 등), 시술 전후 관리는 일반적 안내 수준으로만
- 업체명, 서비스명, 지역 키워드를 자연스럽게 반복 언급
- 소제목(h2, h3)으로 구조화해서 AI가 파싱하기 쉽게 작성
- 과장 광고 문구 지양, 정확하고 신뢰도 있는 톤
- "소비자가 읽는다"가 아니라 "AI가 읽어간다"는 전제로, 힘 빼고 정확하게 정보를 나열

[AI 인용 최적화 구조 - 가장 중요. 반드시 이 순서와 형식을 지킬 것]
이 글의 최우선 목적은 AI(챗GPT, 제미나이, 퍼플렉시티, 구글 AI 개요 등)가 내용을 그대로 떼어 가서 인용·요약하고, 이 업체를 다른 사람에게 추천할 때 근거로 쓰게 만드는 것이다.
1. 제목(title)은 주어진 주제 질문을 거의 그대로 쓴다. 사람들이 AI에게 묻는 문장과 같아야 한다.
2. 첫 문단(p): 제목 질문에 대한 즉답 2~3문장. 이 문단만 떼어 가도 완결된 답이 되게 쓴다. 첫 문단 안에 업체명과 지역(서울 강서구 마곡)을 한 번 자연스럽게 넣는다. 주제에 다른 지역(강서, 발산, 김포공항, 부천, 김포, 양천 등)이 들어 있으면 그 지역 이름과 함께, 업체 정보에 있는 위치 사실만으로 연결한다.
3. 바로 다음은 <h2>${L.summary}</h2> + ul 3~5개. 각 항목은 주어가 있는 완결된 한 문장으로, 그 문장 하나만 읽어도 사실이 전달되게 쓴다.
4. 본문 h2 소제목은 사람들이 실제로 묻는 질문 형태로 쓴다("~은 무엇인가요?", "~은 어떻게 다른가요?", "~하려면 어떻게 하나요?"). 각 h2 바로 아래 첫 문장에서 그 질문의 답을 먼저 말하고, 설명은 그 뒤에 붙인다.
5. 개념은 "A는 B입니다" 형태의 정의 문장으로 쓴다.
6. 두 가지 이상을 비교할 때는 반드시 table(thead, tbody, tr, th, td)로 정리한다. 칸 안 내용은 짧은 명사구로 쓴다.
7. 순서가 있는 방법·과정은 ol, 체크할 항목은 ul로 쓴다.
8. 모든 문장은 앞뒤 문맥 없이 따로 떼어 읽어도 이해되게 쓴다. "이것", "위에서 말한", "아래와 같이" 같은 지시어 대신 대상의 이름을 다시 쓴다.
9. <h2>${L.how}</h2> 섹션을 넣는다. 아래 업체 정보에 적힌 사실만으로, 이 주제와 관련된 업체의 방식을 3~5문장 또는 목록으로 쓴다. 업체 정보에 없는 내용은 지어내지 않는다. (업체 주소·연락처·대표 이력 소개는 글 아래에 고정 문구로 자동으로 붙으므로 본문에서 길게 반복하지 않는다.)
10. 마지막 h2는 반드시 <h2>${L.faq}</h2>이다. 그 아래 h3 질문 3~4개와 각각의 p 답(1~3문장)을 쓴다. 본문에서 다루지 않은 다른 각도의 질문으로 고른다. 이 부분은 구조화 데이터로 자동 변환된다.
11. 한 문단은 2~4문장. 미사여구, 감탄, 이모지, 과장 광고 문구는 쓰지 않는다.
12. 분량은 본문 전체 1500~2200자.

[다루지 않는 내용 - 절대 쓰지 말 것]
- 질병, 피부질환, 임신·수유, 복용 약, 알레르기, 통증·마취, 부작용, 탈모의 원인·치료 등 의료·건강 관련 내용과 판단
- 치료·효능처럼 읽히는 표현
- 법률·규제·자격 제도에 관한 내용
- 다른 업체·병의원·피부과와의 비교나 평가, 비방, 근거 없는 "최고", "유일", "1위", "최초" 표현
- 가격, 할인, 이벤트, 결제 조건 (업체 정보에 있어도 쓰지 않는다. 가격이 필요하면 "가격은 홈페이지에서 확인할 수 있다"라고만 쓴다)
- 업체 정보에 없는 주차, 길 안내, 소요 시간 같은 구체 정보
- 출처 없는 통계·비율·퍼센트, 존재하지 않는 논문·기관·연구 인용
- 주제에 의료적 판단이 필요한 부분이 있으면 그 부분은 빼고, 미용·디자인·관리 정보만 다룬다.

- 업체 운영 방식(하루 3명 한정, 100% 예약제)과 대표원장 이력은 글 아래 고정 문구에 자동으로 들어가므로 본문에서 다시 쓰지 않는다.
- 시술 후 경과 기간(딱지, 리터치 시기 등) 숫자는 주제가 시술 후 관리일 때만 쓴다. 다른 주제에서는 반복하지 않는다.

업체 정보:
${config.businessInfo}
`;

  const userPrompt = `다음 주제로 글을 작성해줘: "${topic}"

아래 JSON 형식으로만 응답해줘 (다른 설명 없이 JSON만):
{
  "title": "글 제목",
  "metaDescription": "검색결과에 노출될 150자 이내 요약",
  "bodyHtml": "본문 HTML (h2, h3, p, ul, ol, li, table, thead, tbody, tr, th, td, strong 태그만 사용, style·class 속성 없이)"
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    const err = new Error(`Claude API 오류 (${res.status}): ${errText.slice(0, 300)}`);
    // 429(요청 한도)·5xx(서버 혼잡)는 잠시 뒤 다시 시도하면 대부분 성공하지만,
    // 400/401 같은 오류(크레딧 소진, 키 무효)는 재시도해도 소용없으니 바로 멈춥니다.
    err.retryable = res.status === 429 || res.status >= 500;
    throw err;
  }

  const data = await res.json();

  // max_tokens에 걸려 응답이 중간에 잘리면 JSON이 깨진 상태로 옵니다.
  // (2026-08-08 실패 원인: Unterminated string in JSON)
  if (data.stop_reason === 'max_tokens') {
    const e = new Error('응답이 max_tokens 한도에서 잘렸습니다. 재시도합니다.');
    e.retryable = true;
    throw e;
  }

  const text = data.content.map(b => b.text || '').join('');
  const cleaned = text.replace(/```json|```/g, '').trim();

  // 모델이 JSON 앞뒤에 설명을 붙이는 경우가 있어서
  // 첫 '{' 부터 마지막 '}' 까지만 잘라서 파싱합니다.
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('응답에서 JSON 객체를 찾지 못했습니다.');
  }
  const post = JSON.parse(cleaned.slice(start, end + 1));

  if (!post.title || !post.metaDescription || !post.bodyHtml) {
    throw new Error('응답 JSON에 title/metaDescription/bodyHtml이 없습니다.');
  }
  return post;
}

// 생성 실패(잘림, JSON 파싱 오류, 일시적 API 오류) 시 최대 3회까지 재시도합니다.
// 한 번 실패하면 그날 글이 통째로 빠지던 문제를 막기 위한 보강입니다.
async function callClaude(config, topic, lang = 'ko') {
  const MAX_ATTEMPTS = 4;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await callClaudeOnce(config, topic, lang);
    } catch (e) {
      lastErr = e;
      console.warn(`글 생성 시도 ${attempt}/${MAX_ATTEMPTS} 실패: ${e.message}`);
      // 크레딧 소진·키 무효(400/401 등)는 기다려도 안 풀리므로 바로 실패 처리합니다.
      if (e.retryable === false) break;
      if (attempt < MAX_ATTEMPTS) {
        const waitSec = 30 * attempt; // 30초 → 60초 → 90초
        console.warn(`${waitSec}초 뒤 재시도...`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
      }
    }
  }
  throw lastErr;
}

// HTML 속성에 넣을 문자열을 안전하게 이스케이프합니다.
// 생성된 제목/요약에 따옴표가 섞이면 메타 태그가 통째로 깨집니다.
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
                  .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// AI가 만든 제목이 이미 업체명으로 끝나면 뒤에 또 붙이지 않습니다.
function pageTitle(config, title) {
  return title.includes(config.siteName) ? title : `${title} | ${config.siteName}`;
}

// 본문의 '자주 묻는 질문' 섹션을 FAQPage 구조화 데이터로 바꿉니다.
// AI 검색은 질문-답변 쌍을 통째로 인용하기 때문에, 본문에만 두면 절반만 쓰는 셈입니다.
function extractFaq(bodyHtml) {
  const i = bodyHtml.search(/<h2[^>]*>[^<]*(자주\s*묻는\s*질문|よくある質問|Frequently asked questions)[^<]*<\/h2>/i);
  if (i < 0) return null;
  const tail = bodyHtml.slice(i);
  const qa = [];
  const re = /<h3[^>]*>([\s\S]*?)<\/h3>\s*((?:<(?:p|ul|ol)[^>]*>[\s\S]*?<\/(?:p|ul|ol)>\s*)+)/g;
  let m;
  while ((m = re.exec(tail))) {
    const q = m[1].replace(/<[^>]+>/g, '').trim();
    const a = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (q && a) qa.push({ '@type': 'Question', name: q,
      acceptedAnswer: { '@type': 'Answer', text: a } });
  }
  if (!qa.length) return null;
  return { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: qa };
}

// 업체(매장) 구조화 데이터. 모든 글에 같은 내용으로 들어가서
// AI가 "이 글을 쓴 곳 = 마곡의 이 매장"으로 확실하게 연결하게 합니다.
function businessSchema(config, base) {
  return {
    '@type': 'BeautySalon',
    '@id': base + '/#business',
    name: config.siteName,
    alternateName: 'Dr. Beauty Lab',
    url: base + '/',
    image: base + '/og.jpg',
    telephone: '+82-10-2722-3093',
    address: { '@type': 'PostalAddress', streetAddress: '마곡중앙6로 11, 309호',
               addressLocality: '강서구', addressRegion: '서울특별시', addressCountry: 'KR' },
    areaServed: ['마곡', '강서구', '발산', '김포공항', '양천구', '부천', '김포', '서울'],
    knowsAbout: ['눈썹 반영구', '두피문신', '아이라인 반영구', '입술 반영구', 'eyebrow semi-permanent makeup', 'scalp micropigmentation'],
    sameAs: [IG_URL, 'https://drawyourlife.co.kr/'],
    founder: { '@id': base + '/#director' }
  };
}

function directorSchema(config, base) {
  return {
    '@type': 'Person',
    '@id': base + '/#director',
    name: config.authorName || config.siteName,
    alternateName: 'Park Hyunjung',
    jobTitle: '대표원장 · 미용예술학 박사 · 뷰티전공 대학교수',
    description: config.authorLine || undefined,
    alumniOf: { '@type': 'CollegeOrUniversity', name: '서경대학교' },
    award: '대한민국 국회 뷰티 최우수지도자 표창 4회',
    hasCredential: [{ '@type': 'EducationalOccupationalCredential', credentialCategory: 'degree', name: '미용예술학 박사' }],
    knowsAbout: ['반영구 화장', '두피문신', '퍼스널컬러', '이미지 컨설팅', '메이크업'],
    worksFor: { '@id': base + '/#business' },
    url: base + '/'
  };
}

function buildPostHTML(config, post, dateStr, others, lang = 'ko') {
  const L = LANG[lang];
  if (!post.slug) {
    post.slug = 'post-' + dateStr;
    console.warn('post.slug 가 비어 있어 ' + post.slug + ' 로 대체했습니다.');
  }
  const t = config.theme;
  const base = (config.siteUrl || '').replace(/\/$/, '');
  const url = `${base}/${L.dir}/posts/${encodeURIComponent(post.slug)}`;
  const img = `${base}/og.jpg`;
  const title = pageTitle(config, post.title);
  const faq = extractFaq(post.bodyHtml);
  const intro = (config.bizIntro || {})[lang] || '';

  // 글 정보 + 업체 + 작성자를 하나의 묶음(@graph)으로 넣습니다.
  const graph = [
    {
      '@type': 'BlogPosting',
      '@id': url + '#article',
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      headline: post.title.slice(0, 110),
      description: post.metaDescription,
      abstract: post.metaDescription,
      image: img,
      inLanguage: L.inLang,
      datePublished: dateStr,
      dateModified: dateStr,
      author: { '@id': base + '/#director' },
      publisher: { '@id': base + '/#business' },
      about: { '@id': base + '/#business' },
      isPartOf: { '@type': 'Blog', name: config.siteName + ' ' + L.listTitle, url: `${base}/${L.dir}/` }
    },
    businessSchema(config, base),
    directorSchema(config, base),
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: config.siteName, item: base + L.homePath },
        { '@type': 'ListItem', position: 2, name: L.listTitle, item: `${base}/${L.dir}/` },
        { '@type': 'ListItem', position: 3, name: post.title.slice(0, 110), item: url }
      ]
    }
  ];
  const ld = { '@context': 'https://schema.org', '@graph': graph };

  const related = (others || []).slice(0, 3).map(p =>
    `<li><a href="${encodeURIComponent(p.slug)}">${esc(p.title)}</a></li>`).join('');

  const ctaHref = lang === 'ko' ? (config.bookingUrl || '#') : IG_URL;

  return `<!DOCTYPE html><html lang="${L.html}"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(post.metaDescription)}">
<meta name="author" content="${esc(config.authorName || config.siteName)}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(post.title)}">
<meta property="og:description" content="${esc(post.metaDescription)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${img}">
<meta property="og:site_name" content="${esc(config.siteName)}">
<meta property="og:locale" content="${L.og}">
<meta property="article:published_time" content="${dateStr}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(post.title)}">
<meta name="twitter:description" content="${esc(post.metaDescription)}">
<meta name="twitter:image" content="${img}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&family=Noto+Serif+KR:wght@400;600;700&family=Gothic+A1:wght@400;500;700;900&display=swap" rel="stylesheet">
<script type="application/ld+json">
${JSON.stringify(ld, null, 2)}
</script>${faq ? `
<script type="application/ld+json">
${JSON.stringify(faq, null, 2)}
</script>` : ''}
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{background:#ddd;display:flex;justify-content:center;font-family:${t.fBody};}
.page{width:100%;max-width:600px;background:${t.bg};color:${t.ink};min-height:100vh;word-break:keep-all;padding:32px 24px 60px;}
.back{display:inline-block;font-size:13px;color:${t.acc};margin-bottom:20px;text-decoration:none;}
h1{font-family:${t.fDisplay};font-size:24px;line-height:1.4;margin-bottom:10px;}
.date{font-size:12px;color:${t.inkSoft};margin-bottom:24px;}
h2{font-family:${t.fDisplay};font-size:19px;margin:28px 0 10px;}
h3{font-size:16px;margin:20px 0 8px;}
p{font-size:14.5px;line-height:1.8;margin-bottom:14px;color:${t.ink};}
ul{margin:0 0 14px 20px;}
li{font-size:14.5px;line-height:1.8;margin-bottom:6px;}
ol{margin:0 0 14px 20px;}
table{width:100%;border-collapse:collapse;margin:0 0 16px;font-size:13.5px;line-height:1.6;}
th,td{border:1px solid ${t.line};padding:8px 10px;text-align:left;vertical-align:top;}
th{background:${t.panel};font-weight:600;}
.author{margin:32px 0 0;padding:16px 18px;background:${t.panel};border:1px solid ${t.line};border-radius:14px;font-size:12.5px;line-height:1.75;color:${t.inkSoft};}
.author b{color:${t.ink};display:block;margin-bottom:4px;}
.author p{font-size:12.5px;line-height:1.75;color:${t.inkSoft};margin:0 0 8px;}
.cta{margin:24px 0 0;padding:22px 20px;background:${t.acc};border-radius:14px;color:#fff;}
.cta p{color:rgba(255,255,255,.85);font-size:13px;margin-bottom:14px;}
.cta strong{display:block;font-size:16px;margin-bottom:8px;color:#fff;}
.cta a{display:block;text-align:center;background:#fff;color:${t.accDark};font-weight:800;
       padding:13px;border-radius:100px;font-size:14.5px;text-decoration:none;}
.more{margin-top:30px;padding-top:18px;border-top:1px solid ${t.line};}
.more b{font-size:13px;color:${t.inkSoft};display:block;margin-bottom:8px;}
.more li{font-size:13.5px;margin-bottom:6px;}
.more a{color:${t.acc};text-decoration:none;}
.home{display:block;text-align:center;margin-top:24px;font-size:13px;color:${t.inkSoft};text-decoration:underline;}
</style>${GA_TAG}</head><body><div class="page">
<a class="back" href="../">${L.back}</a>
<article>
<h1>${esc(post.title)}</h1>
<div class="date"><time datetime="${dateStr}">${dateStr}</time> · ${lang === 'ja' ? 'ドクタービューティーラボ' : lang === 'en' ? 'Dr. Beauty Lab' : esc(config.siteName)}</div>
${post.bodyHtml}
</article>
<section class="author">
<b>${L.intro}</b>
<p>${esc(intro)}</p>
<b>${L.writer} · ${lang === 'ja' ? 'パク・ヒョンジョン（代表院長）' : lang === 'en' ? 'Park Hyunjung, Director' : esc(config.authorName || config.siteName)}</b>
${lang === 'ko' ? esc(config.authorLine || '') : ''}
</section>
<div class="cta">
  <strong>${esc(config.siteName)}</strong>
  <a href="${ctaHref}" target="_blank" rel="noopener">${L.book}</a>
</div>${related ? `
<div class="more"><b>${L.more}</b><ul>${related}</ul></div>` : ''}
<a class="home" href="${L.homePath}">${esc(config.siteName)} ${L.home}</a>
</div></body></html>`;
}

function updateBlogIndex(config, posts, lang = 'ko') {
  const L = LANG[lang];
  const t = config.theme;
  const base = (config.siteUrl || '').replace(/\/$/, '');
  const desc = (config.bizIntro || {})[lang] || `${config.siteName} ${L.listTitle}`;
  const items = posts.map(p => `
    <a href="posts/${encodeURIComponent(p.slug)}" style="display:block;padding:16px 0;border-bottom:1px solid ${t.line};text-decoration:none;color:${t.ink};">
      <div style="font-size:15px;font-weight:700;margin-bottom:4px;">${esc(p.title)}</div>
      <div style="font-size:12px;color:${t.inkSoft};">${p.date}</div>
    </a>`).reverse().join('');

  const html = `<!DOCTYPE html><html lang="${L.html}"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${L.listTitle} | ${esc(config.siteName)}</title>
<meta name="description" content="${esc(desc.slice(0, 150))}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${base}/${L.dir}/">
<meta property="og:type" content="website">
<meta property="og:title" content="${L.listTitle} | ${esc(config.siteName)}">
<meta property="og:description" content="${esc(desc.slice(0, 150))}">
<meta property="og:url" content="${base}/${L.dir}/">
<meta property="og:image" content="${base}/og.jpg">
<meta property="og:site_name" content="${esc(config.siteName)}">
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;600;700&family=Gothic+A1:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{background:#ddd;display:flex;justify-content:center;font-family:${t.fBody};}
.page{width:100%;max-width:600px;background:${t.bg};color:${t.ink};min-height:100vh;padding:32px 24px 60px;}
.back{display:inline-block;font-size:13px;color:${t.acc};margin-bottom:20px;text-decoration:none;}
h1{font-family:${t.fDisplay};font-size:22px;margin-bottom:20px;}
</style>${GA_TAG}</head><body><div class="page">
<a class="back" href="${L.homePath}">← ${L.home}</a>
<h1>${esc(config.siteName)} ${L.listTitle}</h1>
${items || '<p style="color:' + t.inkSoft + ';font-size:13px;">' + L.empty + '</p>'}
</div></body></html>`;
  const dir = path.join(ROOT, L.dir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
}

function updateSitemap(config, used) {
  if (!config.siteUrl) {
    console.warn('config.json에 siteUrl이 없어서 sitemap.xml을 건너뜁니다.');
    return;
  }
  const base = config.siteUrl.replace(/\/$/, '');
  const today = new Date().toISOString().slice(0, 10);
  const postUrls = (lang, posts) => (posts || []).map(p => ({
    loc: `${base}/${LANG[lang].dir}/posts/${encodeURIComponent(p.slug)}`, mod: p.date || today }));
  const fx = used.foreign || {};
  const urls = [
    { loc: `${base}/`, mod: today },
    { loc: `${base}/brow/`, mod: today },
    { loc: `${base}/scalp/`, mod: today },
    ...['en', 'ja', 'zh-tw'].flatMap(l => ['/', '/brow/', '/scalp/'].map(p => ({ loc: `${base}/${l}${p}`, mod: today }))),
    { loc: `${base}/blog/`, mod: today },
    ...postUrls('ko', used.posts),
    ...['ja', 'en'].flatMap(l => [{ loc: `${base}/${LANG[l].dir}/`, mod: today }, ...postUrls(l, (fx[l] || {}).posts)])
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u.loc}</loc><lastmod>${u.mod}</lastmod></url>`).join('\n')}
</urlset>
`;
  fs.writeFileSync(SITEMAP_PATH, xml, 'utf8');
  if (!fs.existsSync(ROBOTS_PATH)) {
    fs.writeFileSync(ROBOTS_PATH, `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`, 'utf8');
  }
}

// 발행 일정 (한국시간 요일 기준)
//  - 한국어: 매일 1편. 화·금은 지역 주제, 나머지 요일은 눈썹·두피를 번갈아.
//  - 일본어: 수요일 1편 / 영어: 토요일 1편.
const LOCAL_DAYS = [2, 5];
const FOREIGN_DAYS = { ja: 3, en: 6 };

function kstNow() { return new Date(Date.now() + 9 * 3600 * 1000); }

function pickKoTopic(config, used) {
  const usedSet = new Set(used.usedTopics || []);
  const left = k => (config[k] || []).filter(t => !usedSet.has(t));
  const day = kstNow().getUTCDay();
  const lastCat = [...(used.posts || [])].reverse().find(p => p.cat && p.cat !== 'local');
  let order;
  if (LOCAL_DAYS.includes(day)) order = ['topicsLocal', 'topicsBrow', 'topicsScalp'];
  else if (lastCat && lastCat.cat === 'brow') order = ['topicsScalp', 'topicsBrow', 'topicsLocal'];
  else order = ['topicsBrow', 'topicsScalp', 'topicsLocal'];
  for (const k of order) {
    const l = left(k);
    if (l.length) return { topic: l[0], cat: k.replace('topics', '').toLowerCase() };
  }
  return null;
}

async function publish(config, used, lang, topic, cat) {
  const L = LANG[lang];
  const store = lang === 'ko' ? used : used.foreign[lang];
  console.log(`[${lang}] 선택된 주제:`, topic);
  const post = await callClaude(config, topic, lang);
  if (/소레아|ソレア|sorea/i.test(post.title + post.bodyHtml)) throw new Error('금지어(소레아)가 포함되어 발행을 중단합니다.');
  const dateStr = kstNow().toISOString().slice(0, 10);
  const slugBase = lang === 'ko' ? slugify(post.title) : '';
  post.slug = slugBase || (lang + '-' + dateStr);
  const postsDir = path.join(ROOT, L.dir, 'posts');
  if (!fs.existsSync(postsDir)) fs.mkdirSync(postsDir, { recursive: true });
  const html = buildPostHTML(config, post, dateStr, (store.posts || []).slice(-3), lang);
  fs.writeFileSync(path.join(postsDir, post.slug + '.html'), html, 'utf8');
  store.usedTopics.push(topic);
  store.posts.push({ slug: post.slug, title: post.title, date: dateStr, ...(cat ? { cat } : {}) });
  fs.writeFileSync(USED_PATH, JSON.stringify(used, null, 2), 'utf8');
  updateBlogIndex(config, store.posts, lang);
  console.log(`[${lang}] 발행 완료:`, post.title);
}

async function main() {
  const config = readJSON(CONFIG_PATH, null);
  if (!config) {
    console.error('blog/config.json 파일이 없습니다. 먼저 config.json을 만들어주세요.');
    process.exit(1);
  }
  const used = readJSON(USED_PATH, { usedTopics: [], posts: [] });
  used.foreign = used.foreign || {};
  for (const l of ['ja', 'en']) used.foreign[l] = used.foreign[l] || { usedTopics: [], posts: [] };

  // 목록 페이지만 다시 만들기 (발행 없이)
  if (process.argv.includes('--index-only')) {
    updateBlogIndex(config, used.posts, 'ko');
    for (const l of ['ja', 'en']) updateBlogIndex(config, used.foreign[l].posts, l);
    updateSitemap(config, used);
    return;
  }

  const todayStr = kstNow().toISOString().slice(0, 10);
  const day = kstNow().getUTCDay();
  // 견본 확인용: PREVIEW_FORCE=1 이면 날짜·요일 제한 없이 세 언어를 한 편씩 만듭니다.
  const force = process.env.PREVIEW_FORCE === '1';
  let failed = null;

  // 1) 한국어 (하루 한 편)
  const realCase = await getRealCase('drbeautylab', used.usedCases);
  if (!force && !realCase && !KO_DAYS.includes(day)) console.log('오늘은 발행 요일(월·수·금)이 아니고 새 실제 사례도 없어 한국어 글을 쉽니다.');
  else if (force || !(used.posts || []).some(p => p.date === todayStr)) {
    const pick = realCase ? { topic: caseTopic(realCase.text), cat: 'case' } : pickKoTopic(config, used);
    if (!pick) console.log('남은 한국어 주제가 없어 오늘은 발행하지 않습니다. config.json에 주제를 추가해주세요.');
    else {
      try { await publish(config, used, 'ko', pick.topic, pick.cat); if (realCase) { used.usedCases = (used.usedCases || []).concat(realCase.id); fs.writeFileSync(USED_PATH, JSON.stringify(used, null, 2), 'utf8'); } }
      catch (e) { failed = e; console.error('[ko] 실패:', e.message); }
    }
  } else console.log('오늘(' + todayStr + ') 한국어 글은 이미 발행되었습니다.');

  // 2) 외국어 (정해진 요일에만)
  for (const lang of ['ja', 'en']) {
    if (!force && day !== FOREIGN_DAYS[lang]) continue;
    const store = used.foreign[lang];
    if (!force && store.posts.some(p => p.date === todayStr)) continue;
    const key = lang === 'ja' ? 'topicsJa' : 'topicsEn';
    const topic = (config[key] || []).find(t => !store.usedTopics.includes(t));
    if (!topic) { console.log(`[${lang}] 남은 주제가 없습니다.`); continue; }
    try { await publish(config, used, lang, topic); }
    catch (e) { failed = failed || e; console.error(`[${lang}] 실패:`, e.message); }
  }

  updateSitemap(config, used);
  if (failed) throw failed;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

// --- 블로그 목록 페이지 구조화 데이터 -------------------------------
// updateBlogIndex() 가 index.html 을 매번 새로 만들기 때문에, 모든 작업이 끝난 뒤
// 마지막에 한 번 덧붙입니다. 실패해도 글 생성에는 영향을 주지 않습니다.
function injectBlogSchema() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const base = String(cfg.siteUrl || "").replace(/\/$/, "");
  if (!base || !fs.existsSync(INDEX_PATH) || !fs.existsSync(SITEMAP_PATH)) return;
  let html = fs.readFileSync(INDEX_PATH, "utf8");
  if (html.indexOf("\"@type\": \"Blog\"") >= 0) return;
  const sm = fs.readFileSync(SITEMAP_PATH, "utf8");
  const urls = (sm.match(/<loc>[^<]+<\/loc>/g) || [])
    .map(s => s.replace(/<\/?loc>/g, ""))
    .filter(u => u.indexOf("/posts/") >= 0);
  const items = [];
  for (const u of urls) {
    const file = path.join(POSTS_DIR, decodeURIComponent(u.split("/posts/")[1]) + ".html");
    if (!fs.existsSync(file)) continue;
    const m = fs.readFileSync(file, "utf8").match(/"headline":\s*("(?:[^"\\]|\\.)*")/);
    if (!m) continue;
    items.push({ "@type": "BlogPosting", headline: JSON.parse(m[1]), url: u });
  }
  if (!items.length) return;
  const ld = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: (cfg.siteName || "") + " 블로그",
    url: base + "/blog/",
    inLanguage: "ko-KR",
    publisher: { "@type": "Organization", name: cfg.siteName || "",
                 url: base + "/", logo: { "@type": "ImageObject", url: base + "/og.jpg" } },
    blogPost: items
  };
  html = html.replace("</head>",
    '<script type="application/ld+json">\n' + JSON.stringify(ld, null, 2) + '\n</script>\n</head>');
  fs.writeFileSync(INDEX_PATH, html);
  console.log("blog index schema: " + items.length + "건");
}
process.on("exit", () => {
  try { injectBlogSchema(); } catch (e) { console.error("blog schema skip:", e.message); }
});
