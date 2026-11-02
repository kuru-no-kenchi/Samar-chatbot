const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const multer = require('multer');
const bcrypt = require('bcrypt');
const User = require('../models/user');
const { PHOTO_DIR, removePhoto } = require('../services/profilePhoto');

const BOTS = ['bot1', 'bot2']; // replace with your real selectedBot values
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isName = (v) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 50;

const updateProfile = async (req, res) => {
    try {
        const { first_name, last_name, email, currentPassword, selectedBot } = req.body;
        const updates = {};

        if (first_name !== undefined) {
            if (!isName(first_name)) return res.status(400).json({ message: 'Invalid first name.' });
            updates.first_name = first_name.trim();
        }
        if (last_name !== undefined) {
            if (!isName(last_name)) return res.status(400).json({ message: 'Invalid last name.' });
            updates.last_name = last_name.trim();
        }
        if (email !== undefined) {
            if (typeof email !== 'string' || email.length > 254 || !EMAIL_RE.test(email.trim())) {
                return res.status(400).json({ message: 'Invalid email.' });
            }
            if (typeof currentPassword !== 'string') {
                return res.status(400).json({ message: 'Current password is required to change your email.' });
            }

            const account = await User.findById(req.user._id).select('+password');
            if (!account || !(await bcrypt.compare(currentPassword, account.password))) {
                return res.status(403).json({ message: 'Current password is incorrect.' });
            }

            updates.email = email.trim().toLowerCase();
        }
        if (selectedBot !== undefined) {
            if (!BOTS.includes(selectedBot)) return res.status(400).json({ message: 'Invalid bot.' });
            updates.selectedBot = selectedBot;
        }
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ message: 'No valid fields provided for update.' });
        }

        const user = await User.findByIdAndUpdate(req.user._id, updates, {
            new: true,
            runValidators: true,
        }).select('-password');
        if (!user) return res.status(404).json({ message: 'User not found.' });

        res.status(200).json({ message: 'Profile updated successfully', user });
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ message: 'Email already in use.' });
        console.error('Update error:', error.message);
        res.status(500).json({ message: 'Error updating profile.' });
    }
};

const getUserData = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('-password');
        if (!user) return res.status(404).json({ message: 'User not found.' });
        res.json(user);
    } catch (error) {
        console.error('Error fetching user profile:', error.message);
        res.status(500).json({ message: 'Server error.' });
    }
};

// ---------- Photo upload ----------
const ALLOWED = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, PHOTO_DIR),
        filename: (req, file, cb) =>
            cb(null, crypto.randomBytes(16).toString('hex') + ALLOWED[file.mimetype]),
    }),
    limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) =>
        ALLOWED[file.mimetype] ? cb(null, true) : cb(new Error('INVALID_FILE_TYPE')),
});

// Wraps multer so its errors become clean JSON responses
const uploadSinglePhoto = (req, res, next) => {
    upload.single('photo')(req, res, (err) => {
        if (!err) return next();
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ message: 'Photo must be 2 MB or smaller.' });
        }
        if (err.message === 'INVALID_FILE_TYPE') {
            return res.status(400).json({ message: 'Only JPEG, PNG or WebP images are allowed.' });
        }
        console.error('Upload error:', err.message);
        res.status(400).json({ message: 'Upload failed.' });
    });
};

// The MIME type comes from the client, so also check the file's real signature
const looksLikeImage = async (filePath, mimetype) => {
    const fd = await fsp.open(filePath, 'r');
    try {
        const buf = Buffer.alloc(12);
        await fd.read(buf, 0, 12, 0);
        if (mimetype === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
        if (mimetype === 'image/png') {
            return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        }
        if (mimetype === 'image/webp') {
            return buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
        }
        return false;
    } finally {
        await fd.close();
    }
};

const uploadPhoto = async (req, res) => {
    const file = req.file;
    try {
        if (!file) return res.status(400).json({ message: 'No file uploaded.' });

        if (!(await looksLikeImage(file.path, file.mimetype))) {
            await removePhoto(file.filename);
            return res.status(400).json({ message: 'The file is not a valid image.' });
        }

        const before = await User.findByIdAndUpdate(req.user._id, { personal_photo: file.filename })
            .select('personal_photo');
        if (!before) {
            await removePhoto(file.filename);
            return res.status(404).json({ message: 'User not found.' });
        }

        await removePhoto(before.personal_photo);
        res.json({ success: true, photo: `/users_photos/${file.filename}` });
    } catch (error) {
        if (file) await removePhoto(file.filename);
        console.error('Error uploading photo:', error.message);
        res.status(500).json({ message: 'Server error.' });
    }
};

module.exports = { updateProfile, getUserData, uploadPhoto, uploadSinglePhoto };