// Cloudflare Workers AI 로 술 알아보기 (무료 하루 할당량 안에서, Worker 의 AI 바인딩 사용)
//
// Workers 무료 플랜은 하루 10,000 뉴런까지 무료이고, 넘으면 요금 대신 오류가 납니다(그때 화면은 기기 안 분석으로 바꿔요).
// 기본 모델은 사진을 읽을 수 있는 Llama 4 Scout. wrangler.jsonc 의 WORKERS_AI_MODEL 로 바꿀 수 있어요.
// 사진 입력 형식은 OpenAI 와 같은 messages + image_url(data URL) 형식으로 보냅니다.
import { IdentifyError } from './claude.js';
import { SYSTEM_PROMPT, userText } from './prompt.js';
import { RESULT_SCHEMA } from './schema.js';

export const DEFAULT_WORKERS_AI_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';

/** 스키마로 빈 JSON 견본 만들기 (작은 모델이 형식을 잘 지키도록 지시문에 넣음) */
export function skeleton(schema) {
  if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, skeleton(v)]));
  if (schema.type === 'array') return [skeleton(schema.items)];
  if (schema.enum) return schema.enum.join('|');
  if (schema.type === 'integer') return 3;
  if (schema.type === 'boolean') return true;
  return '';
}

const JSON_GUIDE = `\n\n출력 형식: 아래 키를 모두 가진 JSON 객체 하나만 출력하세요. 설명 문장이나 코드 블록 표시(\`\`\`) 없이 JSON 만 씁니다. 모르는 값은 빈 문자열("")이나 0 으로 둡니다.\n${JSON.stringify(skeleton(RESULT_SCHEMA))}`;

export function buildWorkersAiInput({ images = [], text = '', withFormat = true }) {
  const prompt = userText({ text, imageCount: images.length });
  const content = images.length
    ? [...images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.data}` } })), { type: 'text', text: prompt }]
    : prompt;
  const input = {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT + JSON_GUIDE },
      { role: 'user', content },
    ],
    max_tokens: 2500,
    temperature: 0.2,
  };
  if (withFormat) input.response_format = { type: 'json_schema', json_schema: RESULT_SCHEMA };
  return input;
}

/** 모델 답에서 JSON 꺼내기 (이미 객체거나, 앞뒤에 글이나 ```json 이 붙은 경우) */
export function parseWorkersAiResponse(out) {
  const r = out?.response ?? out?.result?.response ?? out;
  if (r && typeof r === 'object' && !Array.isArray(r)) return r;
  const text = String(r ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new IdentifyError('AI 응답을 읽지 못했어요. 다시 시도해 주세요.', 502, 'bad_json');
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new IdentifyError('AI 응답을 읽지 못했어요. 다시 시도해 주세요.', 502, 'bad_json');
  }
}

const QUOTA = /4006|neuron|allocation|quota|exceeded|daily limit|upgrade to/i;
const FORMAT = /json mode|response_format|json_schema|couldn.t be met|schema/i;

export function createWorkersAiIdentifier({ ai, model = DEFAULT_WORKERS_AI_MODEL }) {
  async function run(input) {
    try {
      return await ai.run(model, input);
    } catch (err) {
      const msg = String(err?.message || err);
      if (QUOTA.test(msg)) throw new IdentifyError('오늘 무료 AI 사용량을 다 썼어요. 기기 안에서 분석할게요.', 429, 'free_quota');
      throw Object.assign(new Error(msg), { format: FORMAT.test(msg) });
    }
  }

  return {
    model,
    provider: 'workers-ai',
    free: true,
    async identify({ images = [], text = '' }) {
      let out;
      try {
        out = await run(buildWorkersAiInput({ images, text, withFormat: true }));
      } catch (err) {
        if (err instanceof IdentifyError) throw err;
        // JSON 형식 강제를 못 지키면 형식 없이 한 번 더 (지시문의 견본으로 JSON 을 받음)
        try {
          out = await run(buildWorkersAiInput({ images, text, withFormat: false }));
        } catch (err2) {
          if (err2 instanceof IdentifyError) throw err2;
          throw new IdentifyError('무료 AI 가 지금 응답하지 않아요. 기기 안에서 분석할게요.', 502, 'upstream');
        }
      }
      const result = parseWorkersAiResponse(out);
      return { result, model, usage: out?.usage ?? null };
    },
  };
}
