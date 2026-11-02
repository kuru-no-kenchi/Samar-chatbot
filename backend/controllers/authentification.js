const User = require('../models/user');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { signAccessToken, issueRefreshToken, rotateRefreshToken,
  revokeSession, clearRefreshCookie } = require('../services/token');
const RefreshToken = require('../models/refreshToken');
const discussion = require('../models/discussion');
const { removePhoto } = require('../services/profilePhoto');

const registerUser = async (req, res) => {
  try {
    const { first_name, last_name, email, password } = req.body;
    if ([first_name, last_name, email, password].some((v) => typeof v !== 'string')
      || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'Invalid registration data.' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    await new User({
      first_name,
      last_name,
      email: email.toLowerCase(),
      password: hashedPassword,
    }).save();

    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    if (err.code === 11000)
      return res.status(409).json({ error: "Email already in use." });
    console.error("Error registering user:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
      return res
        .status(400)
        .json({ error: "Email and password are required." });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+password');
    const valid = user && (await bcrypt.compare(password, user.password));
    if (!valid)
      return res.status(401).json({ error: "Invalid email or password." });

    const token = signAccessToken(user._id);
    await issueRefreshToken(res, user._id); // sets the httpOnly cookie
    res.status(200).json({
      token,
      user: { email: user.email, first_name: user.first_name, last_name: user.last_name },
    });
  } catch (err) {
    console.error("Error logging in:", err.message);
    res.status(500).json({ error: "Internal server error." });
  }
};


const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
      return res.status(400).json({ error: 'Valid current and new passwords are required (8-128 chars).' });
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(403).json({ error: 'Current password is incorrect.' });
    }

    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();
    await RefreshToken.deleteMany({ user: req.user._id });
    res.status(200).json({ message: 'Password updated.' });
  } catch (err) {
    console.error('Error changing password:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

const deleteUser = async (req, res) => {
  try {
    const { password } = req.body;
    if (typeof password !== 'string') {
      return res.status(400).json({ error: 'Password confirmation is required.' });
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(403).json({ error: 'Incorrect password.' });
    }
    await removePhoto(user.personal_photo);
    await RefreshToken.deleteMany({ user: req.user._id });
    await discussion.deleteMany({ user: req.user._id });
    await User.findByIdAndDelete(req.user._id).select('+password');
    res.status(200).json({ message: 'Account deleted.' });
  } catch (err) {
    console.error('Error deleting user:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

const refresh = async (req, res) => {
  try {
    const userId = await rotateRefreshToken(req, res);
    if (!userId) return res.status(401).json({ error: 'Session expired. Please log in again.' });

    const user = await User.findById(userId).select('email first_name last_name');
    if (!user) return res.status(401).json({ error: 'Session expired. Please log in again.' });

    res.json({
      token: signAccessToken(user._id),
      user: { email: user.email, first_name: user.first_name, last_name: user.last_name },
    });
  } catch (err) {
    console.error('Refresh failed:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

const logout = async (req, res) => {
  try {
    await revokeSession(req);
  } catch (err) {
    console.error('Logout cleanup failed:', err.message);
  }
  clearRefreshCookie(res);
  res.json({ message: 'Logged out.' });
};

const logoutAll = async (req, res) => {
  try {
    await RefreshToken.deleteMany({ user: req.user._id });
    clearRefreshCookie(res);
    res.json({ message: 'Logged out of all devices.' });
  } catch (err) {
    console.error('Logout-all failed:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
};


module.exports = { registerUser, deleteUser, loginUser, changePassword, refresh, logout, logoutAll };
