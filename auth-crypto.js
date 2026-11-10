/**
 * 密码分层保护。
 *
 * 普通用户 3 层:
 *   1. bcrypt(cost 12)          慢速 KDF
 *   2. HMAC-SHA256(pepper)       带密钥的消息认证码
 *   3. scrypt(每用户盐)           内存硬 KDF
 *
 * 管理员 5 层:
 *   4. HMAC-SHA512(pepper2 + 每用户盐)   第四种原语
 *   5. 关键操作的「二次验证」step-up 令牌   时间因子(在 server.js 里实现)
 *
 * pepper 不存在数据库里 —— 它由服务端密钥(JWT_SECRET)⊕数据库里的随机盐派生。
 * 整库被拖走,拿到的也只是不可逆的哈希;而没有数据库里的盐,
 * 光有服务端密钥也算不出 pepper。
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const VERSION = 'v3';
const BCRYPT_ROUNDS = 11;
// scrypt 的成本:约 50-100ms。调大更安全,但登录会变慢。
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };

function hmac(algo, key, data) {
  return crypto.createHmac(algo, key).update(data).digest();
}

// bcrypt 的盐是「$2a$12$」+ 22 个自定义 base64 字符。
// 这里用每用户盐把它拼出来 —— 这样同一份密码 + 同一个盐,算出来的链永远一样,
// 登录时才能重算出同一条链来比对。(直接用 bcrypt.hashSync 会每次随机盐,没法复现。)
const B64 = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function bcryptSaltString(salt16) {
  let out = '';
  for (let i = 0; i < 16; i += 3) {
    out += B64[salt16[i] >> 2];
    out += B64[((salt16[i] & 3) << 4) | (salt16[i + 1] >> 4)];
    out += B64[((salt16[i + 1] & 15) << 2) | (salt16[i + 2] >> 6)];
    out += B64[salt16[i + 2] & 63];
  }
  return '$2a$' + String(BCRYPT_ROUNDS).padStart(2, '0') + '$' + out.slice(0, 22);
}

function deriveChain(plain, salt, pepper1, pepper2, admin) {
  const l1 = bcrypt.hashSync(plain, bcryptSaltString(salt));
  const l2 = hmac('sha256', pepper1, l1);
  const l3 = crypto.scryptSync(l2, salt, 32, SCRYPT);
  if (!admin) return l3;
  return hmac('sha512', Buffer.concat([pepper2, salt]), l3);
}

/**
 * 算一条新的密码哈希。存进数据库的是
 *   v3:<a|u>:<盐hex>:<结果hex>
 * 中间那个 a/u 决定用三层还是五层的链 —— 换算法不需要动数据库结构。
 */
function hashPassword(plain, opts) {
  const salt = opts.salt || crypto.randomBytes(16);
  const admin = !!opts.admin;
  const out = deriveChain(plain, salt, opts.pepper1, opts.pepper2, admin);
  return [VERSION, admin ? 'a' : 'u', salt.toString('hex'), out.toString('hex')].join(':');
}

/** 校验密码。老的 bcrypt-only 哈希(升级前的库)走 verifyLegacy。 */
function verifyPassword(plain, stored, opts) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) return false;
  const admin = parts[1] === 'a';
  let salt, want;
  try {
    salt = Buffer.from(parts[2], 'hex');
    want = Buffer.from(parts[3], 'hex');
  } catch (_) { return false; }
  if (!want.length) return false;
  const got = deriveChain(plain, salt, opts.pepper1, opts.pepper2, admin);
  if (got.length !== want.length) return false;
  return crypto.timingSafeEqual(got, want);
}

function isLegacyHash(stored) {
  return !String(stored || '').startsWith(VERSION + ':');
}

function verifyLegacy(plain, stored) {
  try { return bcrypt.compareSync(plain, String(stored || '')); } catch (_) { return false; }
}

/** 这个哈希有几层保护(给控制台看)。 */
function layerCount(stored) {
  const parts = String(stored || '').split(':');
  if (parts[0] !== VERSION) return 1;
  return parts[1] === 'a' ? 5 : 3;
}

// 用户不存在时也跑一遍同样的 KDF,否则「账号不存在」比「密码错」快得多,
// 攻击者能靠响应时间枚举出哪些账号真实存在。
const DUMMY = crypto.randomBytes(32);
function burnTime(pepper1) {
  const l1 = bcrypt.hashSync('vvechat-dummy-password', BCRYPT_ROUNDS);
  const l2 = hmac('sha256', pepper1, l1);
  crypto.scryptSync(l2, DUMMY, 32, SCRYPT);
}

// 弱口令 —— 注册时直接拒;登录时命中就记一条安全事件(诱导条件之一)。
const WEAK = [
  '123456', '12345678', '123456789', '1234567890', '000000', '111111',
  'password', 'password1', 'passw0rd', 'qwerty', 'qwerty123', 'abc123',
  'admin', 'admin123', 'administrator', 'letmein', 'welcome', 'monkey',
  'dragon', 'iloveyou', 'sunshine', 'princess', 'football', 'baseball',
  'trustno1', 'starwars', 'whatever', '666666', '888888', '5201314',
  'aaa111', 'a123456', 'woaini', '520520', 'qazwsx', 'zxcvbn', 'jessica',
];
function isWeakPassword(p) {
  const s = String(p || '').toLowerCase();
  if (s.length < 8) return true;
  if (WEAK.indexOf(s) >= 0) return true;
  // 全是同一个字符,或者只由数字组成
  if (/^(.)\1+$/.test(s)) return true;
  if (/^\d+$/.test(s)) return true;
  return false;
}

module.exports = {
  VERSION, hashPassword, verifyPassword, isLegacyHash, verifyLegacy,
  layerCount, burnTime, isWeakPassword,
};
