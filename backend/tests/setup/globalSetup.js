const { MongoMemoryServer } = require('mongodb-memory-server');
const path = require('path');
const fs = require('fs');
const os = require('os');

module.exports = async () => {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI_TEST = mongod.getUri('samar_test');
  process.env.PHOTO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'samar-photos'));
  global.__MONGOD__ = mongod;
};