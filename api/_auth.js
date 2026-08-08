export function checkAuth(req, res) {
  const secret = process.env.REMINDERS_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'REMINDERS_SECRET not configured' });
    return false;
  }
  if (req.headers['x-reminders-secret'] !== secret) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}
