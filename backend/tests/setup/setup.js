const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URI_TEST);
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});

afterEach(async () => {
    for (const collection of Object.values(mongoose.connection.collections)) {
        await collection.deleteMany({});
    }
    const dir = process.env.PHOTO_DIR;
    if (dir && fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
    }
});

afterAll(async () => {
    await mongoose.disconnect();
});