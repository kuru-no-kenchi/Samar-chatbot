const Usage = require('../models/usage');

const DAY_MS = 24 * 60 * 60 * 1000;
const GLOBAL = 'global';

const toInt = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

// Read on every call, so a changed .env value (or a test) takes effect immediately. 0 = no limit.
const limits = () => ({
  user: toInt(process.env.DAILY_USER_LIMIT, 30),
  global: toInt(process.env.DAILY_GLOBAL_LIMIT, 45),
});

const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);
const nextReset = (day) => new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS);
const userScope = (userId) => `user:${userId}`;

const snapshot = (used, limit, day) => ({
  used,
  limit,
  remaining: Math.max(0, limit - used),
  resetsAt: nextReset(day).toISOString(),
});

// One atomic step: add 1 only if today's count is still below the limit
const increment = (scope, day, limit) =>
  Usage.findOneAndUpdate({ scope, day, count: { $lt: limit } }, { $inc: { count: 1 } }, { new: true });

async function take(scope, day, limit) {
  const doc = await increment(scope, day, limit);
  if (doc) return doc;

  // Either the limit is reached or today's document doesn't exist yet. Create it if missing, then try once more.
  try {
    await Usage.updateOne(
      { scope, day },
      { $setOnInsert: { count: 0, expireAt: new Date(nextReset(day).getTime() + 2 * DAY_MS) } },
      { upsert: true }
    );
  } catch (err) {
    if (err.code !== 11000) throw err; // another request created it first, which is fine
  }
  return increment(scope, day, limit);
}

const giveBack = (scopes, day) =>
  Usage.updateMany({ scope: { $in: scopes }, day, count: { $gt: 0 } }, { $inc: { count: -1 } });

async function reserve(userId) {
  const day = utcDay();
  const { user: userLimit, global: globalLimit } = limits();
  const taken = [];
  let usage = null;

  if (userLimit > 0) {
    const doc = await take(userScope(userId), day, userLimit);
    if (!doc) return { ok: false, reason: 'user', limit: userLimit, resetsAt: nextReset(day) };
    taken.push(userScope(userId));
    usage = snapshot(doc.count, userLimit, day);
  }

  if (globalLimit > 0) {
    const doc = await take(GLOBAL, day, globalLimit);
    if (!doc) {
      await giveBack(taken, day); // the user shouldn't pay for a message that was refused
      return { ok: false, reason: 'global', limit: globalLimit, resetsAt: nextReset(day) };
    }
    taken.push(GLOBAL);
  }

  return { ok: true, day, scopes: taken, usage };
}

// Gives back the user's message after a failed model call. The global count stays,
// because a failed call may still be counted by the provider.
async function refund(reservation) {
  try {
    const scope = reservation.scopes.find((s) => s.startsWith('user:'));
    if (scope) await giveBack([scope], reservation.day);
  } catch (err) {
    console.error('Quota refund failed:', err.message);
  }
}

// Read-only, for showing "messages left" without using one
async function getUsage(userId) {
  const { user: limit } = limits();
  if (limit <= 0) return null;
  const day = utcDay();
  const doc = await Usage.findOne({ scope: userScope(userId), day }).lean();
  return snapshot(doc?.count ?? 0, limit, day);
}

module.exports = { reserve, refund, getUsage };