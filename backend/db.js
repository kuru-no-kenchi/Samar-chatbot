require('dotenv').config();
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to Mongo database.");
  } catch (err) {
    process.exit(1);
  }
};

module.exports = connectDB;
