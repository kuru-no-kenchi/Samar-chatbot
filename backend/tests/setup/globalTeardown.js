const fs = require('fs');

module.exports = async () => {
  await global.__MONGOD__.stop();
  fs.rmSync(process.env.PHOTO_DIR, { recursive: true, force: true });
};