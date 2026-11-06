const mongoose = require('mongoose');

const usageSchema = new mongoose.Schema({
  scope: { type: String, required: true },  // 'global' or 'user:<id>'
  day: { type: String, required: true },    // 'YYYY-MM-DD', in UTC
  count: { type: Number, default: 0, min: 0 },
  expireAt: { type: Date, required: true },
});

usageSchema.index({ scope: 1, day: 1 }, { unique: true });
usageSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 }); // MongoDB deletes old days by itself

module.exports = mongoose.model('Usage', usageSchema);