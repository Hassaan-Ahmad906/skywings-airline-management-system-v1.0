const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const router = require('../middleware/asyncRouter')();
router.post('/', [
  body('name').isString().trim().isLength({ min: 2, max: 100 }),
  body('email').isString().trim().isLength({ max: 254 }).isEmail(),
  body('category').isIn(['flight_booking','checkin_seat','baggage_claims','corporate_travel','feedback']),
  body('message').isString().trim().isLength({ min: 10, max: 3000 })
], async (req, res) => {
  if (!validationResult(req).isEmpty()) return res.status(400).json({ success: false, message: 'Please provide a name, valid email, category, and a message of 10–3000 characters.' });
  try {
    const { name, email, category, message } = req.body;
    const [result] = await db.pool.execute('INSERT INTO contact_messages (name, email, category, message) VALUES (?, ?, ?, ?)', [name, email, category, message]);
    res.status(201).json({ success: true, message: 'Message saved for the support team', data: { message_id: result.insertId } });
  } catch { res.status(500).json({ success: false, message: 'Message could not be saved. Please retry.' }); }
});
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const page = Number(req.query.page || 1), status = req.query.status || 'all', q = String(req.query.q || '').trim();
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || q.length > 100 || !['all','new','reviewed','resolved','trash'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid inbox filters' });
    let where = status === 'trash' ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL';
    const params = [];
    if (!['all','trash'].includes(status)) { where += ' AND status = ?'; params.push(status); }
    if (q) { where += ' AND (name LIKE ? OR email LIKE ? OR message LIKE ?)'; params.push(...Array(3).fill('%' + q + '%')); }
    const [[count]] = await db.pool.execute(`SELECT COUNT(*) AS total FROM contact_messages WHERE ${where}`, params);
    const [messages] = await db.pool.query(`SELECT * FROM contact_messages WHERE ${where} ORDER BY created_at DESC, message_id DESC LIMIT 20 OFFSET ?`, [...params, (page - 1) * 20]);
    res.json({ success: true, data: { messages, total: Number(count.total), page, pages: Math.ceil(count.total / 20) } });
  } catch { res.status(500).json({ success: false, message: 'Unable to load messages' }); }
});
async function updateMessage(req, res, action) {
  const id = Number(req.params.id), status = req.body.status;
  if (!Number.isSafeInteger(id) || id < 1 || (action === 'status' && !['new','reviewed','resolved'].includes(status))) return res.status(400).json({ success: false, message: 'Invalid message or status' });
  const connection = await db.pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[message]] = await connection.execute('SELECT message_id, status, deleted_at FROM contact_messages WHERE message_id = ? FOR UPDATE', [id]);
    if (!message) { await connection.rollback(); return res.status(404).json({ success: false, message: 'Message not found' }); }
    if (action === 'status' && message.deleted_at) { await connection.rollback(); return res.status(409).json({ success: false, message: 'Restore the message before updating its status' }); }
    if (action === 'status') await connection.execute('UPDATE contact_messages SET status = ? WHERE message_id = ?', [status, id]);
    else await connection.execute(`UPDATE contact_messages SET deleted_at = ${action === 'delete' ? 'NOW()' : 'NULL'} WHERE message_id = ?`, [id]);
    await require('../services/auditService').logEvent({ userId: req.user.userId, action: `SUPPORT_MESSAGE_${action.toUpperCase()}`, resourceType: 'CONTACT_MESSAGE', resourceId: id, oldValue: { status: message.status, deleted: !!message.deleted_at }, newValue: { status: action === 'status' ? status : message.status, deleted: action === 'delete' }, req, connection });
    await connection.commit();
    res.json({ success: true, message: action === 'delete' ? 'Message moved to Trash' : 'Message updated' });
  } catch (error) { await connection.rollback(); res.status(500).json({ success: false, message: 'Unable to update message' }); }
  finally { connection.release(); }
}
router.patch('/:id', authenticate, requireAdmin, (req, res) => updateMessage(req, res, 'status'));
router.delete('/:id', authenticate, requireAdmin, (req, res) => updateMessage(req, res, 'delete'));
router.post('/:id/restore', authenticate, requireAdmin, (req, res) => updateMessage(req, res, 'restore'));
module.exports = router;
