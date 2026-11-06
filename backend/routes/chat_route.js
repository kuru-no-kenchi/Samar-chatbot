const express = require('express');
const router = express.Router();
const { chatController, getdiscussions, getdiscussionMessages, deleteConversation, modifyDiscussion, deleteAllConversation, getQuota } = require('../controllers/chat');
const { authMiddleware } = require('../services/jwt');
const { chatLimiter } = require('../services/rateLimit');


router.post('/new', authMiddleware, chatLimiter, chatController);
router.get('/discussions', authMiddleware, getdiscussions);
router.delete('/discussions', authMiddleware, deleteAllConversation);
router.get('/quota', authMiddleware, getQuota);
router.get('/discussions/:discussionId/messages', authMiddleware, getdiscussionMessages);
router.patch('/discussions/:discussionId', authMiddleware, modifyDiscussion);
router.delete('/discussions/:discussionId', authMiddleware, deleteConversation);


module.exports = router;