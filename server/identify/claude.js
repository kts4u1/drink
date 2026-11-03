// Claude API 로 술 알아보기 (Node 개발 서버와 Cloudflare Worker 공통)
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, userText } from './prompt.js';
import { RESULT_SCHEMA } from './schema.js';

export const DEFAULT_MODEL = 'claude-opus-5-5';

export class IdentifyError extends Error {
  constructor(message, status = 502, code = 'upstream') {
    super(message);
    this.name = 'IdentifyError';
    this.status = status;
    this.code = code;
  }
}

/** Haiku 는 서버 쪽 대체 모델(fallback)이 없어서 fallbacks 를 보내면 안 됨 */
export function supportsFallback(model) {
  return !/haiku/i.test(model);
}

/**
 * API 요청 본문 만들기 (테스트에서 모양을 확인할 수 있게 따로 둠)
 * images: [{ mediaType: 'image/jpeg', data: '<base64>' }]
 */
export function buildRequest({ model = DEFAULT_MODEL, images = [], text = '', effort = 'medium' }) {
  const content = [
    ...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })),
    { type: 'text', text: userText({ text, imageCount: images.length }) },
  ];
  const request = {
    model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
    output_config: { effort, format: { type: 'json_schema', schema: RESULT_SCHEMA } },
  };
  if (supportsFallback(model)) {
    // 안전 분류기가 잘못 거절했을 때 Anthropic 이 권장하는 다른 모델로 한 번 더 시도
    request.betas = ['server-side-fallback-2026-07-01'];
    request.fallbacks = 'default';
  }
  return request;
}

/** 응답에서 JSON 꺼내기 (thinking·fallback 블록은 건너뜀) */
export function parseResponse(response) {
  if (response.stop_reason === 'refusal') {
    throw new IdentifyError('이 사진은 분석할 수 없어요. 술병 라벨이 잘 보이게 다시 찍어 주세요.', 422, 'refusal');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new IdentifyError('설명이 너무 길어져 끊겼어요. 다시 시도해 주세요.', 502, 'max_tokens');
  }
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new IdentifyError('AI 응답을 읽지 못했어요. 다시 시도해 주세요.', 502, 'bad_json');
  }
}

/**
 * apiKey: Anthropic API 키, model: 쓸 모델, baseURL: 테스트용 가짜 서버 주소
 */
export function createIdentifier({ apiKey, model = DEFAULT_MODEL, baseURL, effort = 'medium', maxRetries = 1, timeout = 90_000 }) {
  const client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}), maxRetries, timeout });

  return {
    model,
    async identify({ images = [], text = '' }) {
      let response;
      try {
        response = await client.beta.messages.create(buildRequest({ model, images, text, effort }));
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError) {
          throw new IdentifyError('서버의 Anthropic API 키가 올바르지 않아요. 관리자에게 알려 주세요.', 503, 'auth');
        } else if (err instanceof Anthropic.RateLimitError) {
          throw new IdentifyError('지금 사용하는 사람이 많아요. 잠시 후 다시 시도해 주세요.', 429, 'rate_limit');
        } else if (err instanceof Anthropic.BadRequestError) {
          throw new IdentifyError('사진을 처리하지 못했어요. 다른 사진으로 시도해 주세요.', 400, 'bad_request');
        } else if (err instanceof Anthropic.APIError) {
          throw new IdentifyError('AI 서버가 잠시 응답하지 않아요. 잠시 후 다시 시도해 주세요.', 502, 'upstream');
        }
        throw new IdentifyError('AI 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.', 502, 'network');
      }
      const result = parseResponse(response);
      return { result, model: response.model, usage: response.usage };
    },
  };
}
