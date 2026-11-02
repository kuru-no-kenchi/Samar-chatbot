const fs = require('fs');
const path = require('path');

const PHOTO_DIR = process.env.PHOTO_DIR || path.join(__dirname, '..', 'users_photos');
fs.mkdirSync(PHOTO_DIR, { recursive: true });

async function removePhoto(filename) {
  if (!filename) return;

  try {
    await fs.promises.unlink(path.join(PHOTO_DIR, path.basename(filename)));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

module.exports = { PHOTO_DIR, removePhoto };
