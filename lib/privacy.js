/**
 * 脱敏
 * ====
 *
 * 原话档案要忠实，但不必留下证件号和密钥。
 *
 * 两件事分开做，别混：
 *   遮蔽  原话照写，但把敏感串换成稳定 token——同一个号永远同一个 token，
 *         所以「他提过手机号」这个事实保住了，号码没有了
 *   拒收  像凭据、证件的句子，根本不写进记忆卡（写进去也没意义）
 *
 * token 是 sha256 前 6 位：不可逆、不可猜、可对账。
 */
import { createHash } from 'node:crypto'

function tok(kind, raw) {
  const h = createHash('sha256').update(String(raw)).digest('hex').slice(0, 6)
  return '<' + kind + ':' + h + '>'
}

/* 手机号：中国大陆 11 位，前后不能再接数字 */
const RE_PHONE = /(?<!\d)1[3-9]\d{9}(?!\d)/g
/* 身份证：18 位，末位可能是 X */
const RE_ID = /(?<!\d)\d{17}[\dXx](?!\d)/g
/* 银行卡：16~19 位纯数字（身份证那轮已经先处理掉） */
const RE_CARD = /(?<!\d)\d{16,19}(?!\d)/g
/* 带前缀的密钥 */
const RE_KEYS = [
  /\b(sk-[A-Za-z0-9\-_]{16,})/g,
  /\b(npm_[A-Za-z0-9]{16,})/g,
  /\b(gh[pousr]_[A-Za-z0-9]{16,})/g,
  /\b(AKIA[0-9A-Z]{16})\b/g,
]
/* 「密码是 xxx」「token: xxx」这种 */
const RE_NAMED_SECRET =
  /((?:密码|口令|password|passwd|token|密钥)\s*[:：=是]\s*)([^\s，。；;、,]{4,})/gi

/** 遮蔽：把敏感串换成稳定 token。同一串永远换出同一个 token。 */
export function mask(text) {
  let s = String(text || '')
  if (!s) return s

  s = s.replace(RE_PHONE, (m) => tok('phone', m))
  s = s.replace(RE_ID, (m) => tok('id', m))
  s = s.replace(RE_CARD, (m) => tok('card', m))
  for (const re of RE_KEYS) s = s.replace(re, (m) => tok('key', m))
  s = s.replace(RE_NAMED_SECRET, (_all, head, secret) => head + tok('secret', secret))

  return s
}

/** 这句话里有没有敏感串（要不要拒收，用它判断） */
export function hasSecret(text) {
  const s = String(text || '')
  if (!s) return false
  if (/(?<!\d)1[3-9]\d{9}(?!\d)/.test(s)) return true
  if (/(?<!\d)\d{17}[\dXx](?!\d)/.test(s)) return true
  if (/(?<!\d)\d{16,19}(?!\d)/.test(s)) return true
  if (/\bsk-[A-Za-z0-9\-_]{16,}/.test(s)) return true
  if (/\bnpm_[A-Za-z0-9]{16,}/.test(s)) return true
  if (/\bgh[pousr]_[A-Za-z0-9]{16,}/.test(s)) return true
  if (/\bAKIA[0-9A-Z]{16}\b/.test(s)) return true
  if (/(?:密码|口令|password|passwd)\s*[:：=是]\s*\S{4,}/i.test(s)) return true
  return false
}
