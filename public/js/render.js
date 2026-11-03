// 백과 글 섹션 그리기 (콘텐츠 파일의 sections 형식)
// 콘텐츠의 문자열은 이 저장소에서 직접 쓴 것이라 <b> 정도의 간단한 강조 태그를 허용합니다.
// 그 밖의 태그는 지워서, 혹시 잘못 들어가도 스크립트가 실행되지 않게 합니다.
import { CHANNELS } from './content/index.js';
import { escapeHtml } from './util.js';

/** <b>, </b>, <br> 만 남기고 나머지는 글자로 */
export function rich(text) {
  return escapeHtml(text).replace(/&lt;(\/?)(b|br)&gt;/g, '<$1$2>');
}

function paragraphs(text) {
  return String(text)
    .split(/\n\n+/)
    .map((p) => `<p>${rich(p)}</p>`)
    .join('');
}

export function meter(value, max = 5) {
  return `<span class="meter" aria-label="${value}/${max}">${Array.from({ length: max }, (_, i) => `<i class="${i < value ? 'on' : ''}"></i>`).join('')}</span>`;
}

/** 구매처 카드 하나 (score·why 가 있으면 그 술에 맞춘 이유) */
export function channelCard(chId, { why, score, nearHtml = '' } = {}) {
  const ch = CHANNELS[chId];
  if (!ch) return '';
  return `
    <div class="channel">
      <div class="ic" aria-hidden="true">${ch.emoji}</div>
      <div>
        <div class="h"><b>${escapeHtml(ch.name)}</b>${score >= 5 ? '<span class="badge good">추천</span>' : ''}</div>
        <div class="desc">${escapeHtml(ch.desc)}</div>
        <p>${rich(why || ch.good)}</p>
        ${why ? '' : ch.caution ? `<p class="caution">${rich(ch.caution)}</p>` : ''}
        <div class="meters"><span>가격 ${meter(ch.cheap)}</span><span>종류 ${meter(ch.variety)}</span></div>
        ${nearHtml}
      </div>
    </div>`;
}

export function renderSection(sec) {
  const parts = [];
  if (sec.lead) parts.push(`<p class="lead">${rich(sec.lead)}</p>`);
  if (sec.text) parts.push(`<div class="prose">${paragraphs(sec.text)}</div>`);
  if (sec.steps) {
    parts.push(`<ol class="steps">${sec.steps.map((s) => `<li><div><b>${escapeHtml(s.name)}</b>${rich(s.desc)}</div></li>`).join('')}</ol>`);
  }
  if (sec.cards) {
    parts.push(
      `<div class="info-cards">${sec.cards
        .map(
          (c) => `<div class="info-card">
            <div class="h"><b>${escapeHtml(c.name)}</b>${c.tag ? `<span class="badge plain">${escapeHtml(c.tag)}</span>` : ''}</div>
            <p>${rich(c.desc)}</p>
            ${c.ex ? `<div class="ex">${escapeHtml(c.ex)}</div>` : ''}
          </div>`,
        )
        .join('')}</div>`,
    );
  }
  if (sec.terms) {
    parts.push(`<div class="terms">${sec.terms.map((t) => `<div><b>${escapeHtml(t.term)}</b><p>${rich(t.desc)}</p></div>`).join('')}</div>`);
  }
  if (sec.facts) {
    parts.push(`<dl class="facts">${sec.facts.map((f) => `<div><dt>${escapeHtml(f.k)}</dt><dd>${rich(f.v)}</dd></div>`).join('')}</dl>`);
  }
  if (sec.pairs) {
    parts.push(`<div class="pairs">${sec.pairs.map((p) => `<div><b>${escapeHtml(p.food)}</b><span>${rich(p.match)}</span></div>`).join('')}</div>`);
  }
  if (sec.tiers) {
    parts.push(`<div class="tiers">${sec.tiers.map((t) => `<div><b>${escapeHtml(t.range)}</b><span>${rich(t.desc)}</span></div>`).join('')}</div>`);
  }
  if (sec.recipes) {
    parts.push(
      `<div class="recipes">${sec.recipes
        .map(
          (r) => `<div class="recipe">
            <h3>${escapeHtml(r.name)} <span class="badge plain">${escapeHtml(r.base)}</span></h3>
            <ol>${r.recipe.map((step) => `<li>${rich(step)}</li>`).join('')}</ol>
            ${r.tip ? `<p class="tip">${rich(r.tip)}</p>` : ''}
          </div>`,
        )
        .join('')}</div>`,
    );
  }
  if (sec.channels) parts.push(`<div class="channel-list">${sec.channels.map((id) => channelCard(id)).join('')}</div>`);
  if (sec.list) parts.push(`<ul class="bullets">${sec.list.map((li) => `<li>${rich(li)}</li>`).join('')}</ul>`);
  if (sec.faq) {
    parts.push(`<div class="faq">${sec.faq.map((f) => `<details><summary>${escapeHtml(f.q)}</summary><p>${rich(f.a)}</p></details>`).join('')}</div>`);
  }
  return `<section class="block" id="sec-${escapeHtml(sec.id)}"><h2>${escapeHtml(sec.title)}</h2>${parts.join('')}</section>`;
}
