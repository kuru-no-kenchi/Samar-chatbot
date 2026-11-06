require('dotenv').config();
const mongoose = require('mongoose');
const discussion = require('../models/discussion');
const User = require('../models/user');
const { chat } = require('../services/llm');
const quota = require('../services/daily_quota');

const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY = 20;
const MAX_TITLE_LENGTH = 80;

const isValidId = (id) => typeof id === 'string' && mongoose.isValidObjectId(id);


const cleanHistory = (arr) =>
  (Array.isArray(arr) ? arr : [])
    .filter(m => m && ['user', 'assistant'].includes(m.role)
      && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_HISTORY)
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_LENGTH) }));

const chatController = async (req, res) => {
  try {
    const { message, discussionId, history: clientHistory } = req.body;

    if (typeof message !== 'string' || !message.trim() || message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: 'Invalid message.' });
    }
    if (discussionId && !isValidId(discussionId)) {
      return res.status(400).json({ error: 'Invalid discussion id.' });
    }
    const text = message.trim();

    const user = await User.findById(req.user._id).select('email preferences');
    if (!user) return res.status(401).json({ error: 'User not found.' });

    const saveHistory = Boolean(user.preferences?.conversationHistory);

    let existing = null;
    if (discussionId) {
      existing = await discussion.findOne({ _id: discussionId, user: req.user._id });
      if (!existing) return res.status(404).json({ error: 'Discussion not found.' });
    }

    let history = saveHistory
      ? (existing?.messages ?? []).slice(-MAX_HISTORY).map(m => ({ role: m.role, content: m.content }))
      : cleanHistory(clientHistory);
    while (history.length && history[0].role !== 'user') history.shift();
    history.push({ role: 'user', content: text });

    const reservation = await quota.reserve(user._id);
    if (!reservation.ok) {
      const everyone = reservation.reason === 'global';
      return res.status(429).json({
        error: everyone
          ? 'The assistant has reached its daily limit for everyone. Please try again tomorrow.'
          : `You have used all ${reservation.limit} of today's messages. They reset at midnight UTC.`,
        code: everyone ? 'GLOBAL_LIMIT' : 'DAILY_LIMIT',
        resetsAt: reservation.resetsAt,
      });
    }

    let assistantReply;
    try {
      assistantReply = await chat(history);
    } catch (err) {
      await quota.refund(reservation);
      if (err.status === 429) {
        return res.status(429).json({ error: 'The assistant is busy or the daily limit was reached. Try again later.' });
      }
      return res.status(502).json({ error: 'The assistant is unavailable right now.' });
    }
    if (!assistantReply) {
      await quota.refund(reservation);
      return res.status(502).json({ error: 'Empty response from the assistant.' });
    }

    if (!saveHistory) {
      return res.status(200).json({
        reply: assistantReply,
        message: 'Message not saved (history disabled)',
        quota: reservation.usage,
      });
    }

    const now = new Date();
    const messagesToSave = [
      { role: 'user', content: text, timestamp: now },
      { role: 'assistant', content: assistantReply, timestamp: now },
    ];

    const saved = existing
      ? await discussion.findOneAndUpdate(
        { _id: existing._id, user: req.user._id },
        {
          $push: { messages: { $each: messagesToSave } },
          $set: {
            // First message in a chat created by newChat: give it a real title
            ...(existing.messages.length === 0 && { title: text.slice(0, 40) }),
          },
        },
        { new: true }
      )
      : await discussion.create({
        user: req.user._id,
        title: text.slice(0, 40) || 'New Chat',
        messages: messagesToSave,
      });

    res.status(200).json({
      success: true,
      reply: assistantReply,
      discussion: { _id: saved._id, title: saved.title },
      quota: reservation.usage,
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getQuota = async (req, res) => {
  try {
    res.json({ quota: await quota.getUsage(req.user._id) });
  } catch (err) {
    console.error('getQuota failed:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getdiscussionMessages = async (req, res) => {
  try {
    const { discussionId } = req.params;
    if (!isValidId(discussionId)) return res.status(400).json({ error: 'Invalid discussion id.' });


    const convo = await discussion.findOne({ _id: discussionId, user: req.user._id });
    if (!convo) return res.status(404).json({ error: 'Discussion not found' });

    res.status(200).json({ success: true, messages: convo.messages });
  } catch (err) {
    console.error('Error fetching messages:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getdiscussions = async (req, res) => {
  try {


    const convos = await discussion.find({ user: req.user._id })
      .select('_id title createdAt updatedAt')
      .sort({ updatedAt: -1 });

    res.json({ success: true, count: convos.length, discussions: convos });
  } catch (error) {
    console.error('getdiscussions failed:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};


const deleteConversation = async (req, res) => {
  try {
    const { discussionId } = req.params;
    if (!isValidId(discussionId)) return res.status(400).json({ error: 'Invalid discussion id.' });


    const conversation = await discussion.findOneAndDelete({ _id: discussionId, user: req.user._id });
    if (!conversation) return res.status(404).json({ error: 'Discussion not found' });

    res.json({ message: 'Discussion deleted' });
  } catch (error) {
    console.error('deleteConversation failed:', error.message);
    res.status(500).json({ error: 'Failed to delete this discussion' });
  }
};

const deleteAllConversation = async (req, res) => {
  try {

    const result = await discussion.deleteMany({ user: req.user._id });
    res.json({ success: true, message: `${result.deletedCount} discussions deleted successfully` });
  } catch (error) {
    console.error('deleteAllConversation failed:', error.message);
    res.status(500).json({ error: 'Failed to delete all discussions' });
  }
};

const modifyDiscussion = async (req, res) => {
  try {
    const { discussionId } = req.params;
    const { title } = req.body;

    if (!isValidId(discussionId)) return res.status(400).json({ error: 'Invalid discussion id.' });
    if (typeof title !== 'string' || !title.trim() || title.length > MAX_TITLE_LENGTH) {
      return res.status(400).json({ error: `Title must be 1-${MAX_TITLE_LENGTH} characters.` });
    }

    const conversation = await discussion.findOneAndUpdate(
      { _id: discussionId, user: req.user._id },
      { title: title.trim() },
      { new: true }
    );
    if (!conversation) return res.status(404).json({ error: 'Discussion not found' });

    res.json({ message: 'Discussion updated' });
  } catch (error) {
    console.error('modifyDiscussion failed:', error.message);
    res.status(500).json({ error: 'Failed to update this discussion' });
  }
};

module.exports = {
  chatController, getdiscussionMessages, getQuota, getdiscussions,
  deleteConversation, modifyDiscussion, deleteAllConversation,
};