const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');

// Allow all origins (simplify dev/prod access)
app.use(cors({ origin: true }));
app.use(express.json());

if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';

// Auth helpers
const signToken = (user) =>
  jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

const authMiddleware = async (req, res, next) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

// Seed categories if missing
const ensureCategories = async () => {
  const defaults = ['Lactate', 'Legume', 'Fructe', 'Carne', 'Conserve', 'Băuturi'];
  const existing = await prisma.foodCategory.findMany({ where: { name: { in: defaults } } });
  if (existing.length === defaults.length) return;
  const toCreate = defaults.filter((n) => !existing.find((c) => c.name === n));
  if (toCreate.length > 0) {
    await prisma.foodCategory.createMany({
      data: toCreate.map((name) => ({ name })),
    });
  }
};

// Auth routes
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required' });
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { name, email, passwordHash } });
    const token = signToken(user);
    res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error('Error register:', err);
    res.status(500).json({ error: 'Failed to register' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = signToken(user);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error('Error login:', err);
    res.status(500).json({ error: 'Failed to login' });
  }
});

app.get('/api/me', authMiddleware, async (req, res) => {
  res.json({ id: req.user.id, name: req.user.name, email: req.user.email });
});

// Donations (legacy quick share)
app.get('/api/donations', async (_req, res) => {
  try {
    const donations = await prisma.donation.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(donations);
  } catch (err) {
    console.error('Error fetching donations:', err);
    res.status(500).json({ error: 'Failed to fetch donations' });
  }
});

app.post('/api/donations', async (req, res) => {
  const { item, quantity, location } = req.body;

  if (!item || !quantity || !location) {
    return res.status(400).json({ error: 'item, quantity, and location are required' });
  }

  try {
    const donation = await prisma.donation.create({
      data: { item, quantity, location },
    });
    res.status(201).json(donation);
  } catch (err) {
    console.error('Error creating donation:', err);
    res.status(500).json({ error: 'Failed to create donation' });
  }
});

// Food items
app.get('/api/items', authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    const items = await prisma.foodItem.findMany({
      where: { ownerId: user.id },
      include: { category: true, claims: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(items);
  } catch (err) {
    console.error('Error fetching items:', err);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

app.post('/api/items', authMiddleware, async (req, res) => {
  const { title, categoryId, expiresAt } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });

  try {
    const user = req.user;
    await ensureCategories();
    const item = await prisma.foodItem.create({
      data: {
        title,
        categoryId: categoryId || null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        ownerId: user.id,
      },
      include: { category: true },
    });
    res.status(201).json(item);
  } catch (err) {
    console.error('Error creating item:', err);
    res.status(500).json({ error: 'Failed to create item' });
  }
});

app.patch('/api/items/:id/status', authMiddleware, async (req, res) => {
  const { status } = req.body;
  const id = Number(req.params.id);
  if (!['IN_FRIDGE', 'AVAILABLE', 'CLAIMED'].includes(status)) {
    return res.status(400).json({ error: 'invalid status' });
  }
  try {
    const user = req.user;
    const updated = await prisma.foodItem.update({
      where: { id_ownerId: { id, ownerId: user.id } },
      data: { status },
    });
    res.json(updated);
  } catch (err) {
    console.error('Error updating status:', err);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

app.get('/api/items/expiring', authMiddleware, async (req, res) => {
  const days = Number(req.query.days || 3);
  const until = new Date();
  until.setDate(until.getDate() + days);
  try {
    const user = req.user;
    const items = await prisma.foodItem.findMany({
      where: {
        ownerId: user.id,
        expiresAt: { lte: until },
        status: 'IN_FRIDGE',
      },
      orderBy: { expiresAt: 'asc' },
    });
    res.json(items);
  } catch (err) {
    console.error('Error fetching expiring items:', err);
    res.status(500).json({ error: 'Failed to fetch expiring items' });
  }
});

// Categories
app.get('/api/categories', async (_req, res) => {
  try {
    await ensureCategories();
    const categories = await prisma.foodCategory.findMany({ orderBy: { name: 'asc' } });
    res.json(categories);
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// User search (existing accounts only)
app.get('/api/users/search', authMiddleware, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.status(400).json({ error: 'q must have at least 2 characters' });
  try {
    const users = await prisma.user.findMany({
      where: {
        AND: [
          {
            OR: [
              { name: { contains: q } },
              { email: { contains: q } },
            ],
          },
          { id: { not: req.user.id } },
        ],
      },
      select: { id: true, name: true, email: true },
      take: 10,
      orderBy: { createdAt: 'desc' },
    });
    res.json(users);
  } catch (err) {
    console.error('Error searching users:', err);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

// Groups
app.get('/api/groups', authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    const groups = await prisma.friendGroup.findMany({
      where: {
        OR: [
          { ownerId: user.id },
          { members: { some: { userId: user.id } } },
        ],
      },
      include: { members: { include: { user: true } }, owner: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(groups);
  } catch (err) {
    console.error('Error fetching groups:', err);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

app.post('/api/groups', authMiddleware, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const user = req.user;
    const group = await prisma.friendGroup.create({ data: { name, ownerId: user.id } });
    res.status(201).json(group);
  } catch (err) {
    console.error('Error creating group:', err);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

app.post('/api/groups/:id/members', authMiddleware, async (req, res) => {
  const { userId, tag } = req.body;
  const groupId = Number(req.params.id);
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    const owner = req.user;
    const group = await prisma.friendGroup.findFirst({ where: { id: groupId, ownerId: owner.id } });
    if (!group) return res.status(404).json({ error: 'group not found' });

    const friend = await prisma.user.findUnique({ where: { id: Number(userId) } });
    if (!friend) return res.status(404).json({ error: 'user not found' });

    const existingMember = await prisma.groupMember.findFirst({
      where: { groupId, userId: friend.id },
      include: { user: true },
    });
    if (existingMember) return res.status(409).json({ error: 'User already in group' });

    const member = await prisma.groupMember.create({
      data: { groupId, userId: friend.id, tag: tag || null },
      include: { user: true },
    });
    res.status(201).json(member);
  } catch (err) {
    console.error('Error adding member:', err);
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// Claims
app.post('/api/claims', authMiddleware, async (req, res) => {
  const { itemId } = req.body;
  if (!itemId) return res.status(400).json({ error: 'itemId required' });
  try {
    const user = req.user;
    const item = await prisma.foodItem.findUnique({ where: { id: itemId } });
    if (!item || item.status !== 'AVAILABLE') return res.status(400).json({ error: 'Item not available' });
    if (item.ownerId === user.id) return res.status(400).json({ error: 'Cannot claim own item' });
    const claim = await prisma.claim.create({
      data: { itemId, claimerId: user.id },
      include: { claimer: true },
    });
    res.status(201).json(claim);
  } catch (err) {
    console.error('Error creating claim:', err);
    res.status(500).json({ error: 'Failed to create claim' });
  }
});

app.get('/api/claims/for-owner', authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    const claims = await prisma.claim.findMany({
      where: { item: { ownerId: user.id } },
      include: { claimer: true, item: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(claims);
  } catch (err) {
    console.error('Error fetching owner claims:', err);
    res.status(500).json({ error: 'Failed to fetch claims' });
  }
});

app.get('/api/claims/mine', authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    const claims = await prisma.claim.findMany({
      where: { claimerId: user.id },
      include: { item: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(claims);
  } catch (err) {
    console.error('Error fetching my claims:', err);
    res.status(500).json({ error: 'Failed to fetch claims' });
  }
});

app.post('/api/claims/:id/decision', authMiddleware, async (req, res) => {
  const { decision } = req.body;
  const id = Number(req.params.id);
  if (!['ACCEPTED', 'REJECTED'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be ACCEPTED or REJECTED' });
  }
  try {
    const user = req.user;
    const claim = await prisma.claim.findUnique({ where: { id }, include: { item: true } });
    if (!claim || claim.item.ownerId !== user.id) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const updated = await prisma.claim.update({
      where: { id },
      data: { status: decision, decidedAt: new Date() },
      include: { item: true, claimer: true },
    });
    if (decision === 'ACCEPTED') {
      await prisma.foodItem.update({ where: { id: claim.itemId }, data: { status: 'CLAIMED' } });
    }
    res.json(updated);
  } catch (err) {
    console.error('Error deciding claim:', err);
    res.status(500).json({ error: 'Failed to update claim' });
  }
});

// Social share stub
app.post('/api/share', authMiddleware, async (req, res) => {
  const { itemId, network } = req.body;
  if (!itemId || !network) return res.status(400).json({ error: 'itemId and network required' });
  const supported = ['instagram', 'facebook'];
  if (!supported.includes(network)) {
    return res.status(400).json({ error: 'network must be instagram or facebook' });
  }
  const shareUrl = `https://example.com/share/${network}/item/${itemId}`;
  res.json({ shareUrl, note: 'Stubbed share link (no real integration).' });
});

// Public endpoint: available items to claim
app.get('/api/items/available', authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    const items = await prisma.foodItem.findMany({
      where: { status: 'AVAILABLE', ownerId: { not: user.id } },
      include: { owner: true, category: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(items);
  } catch (err) {
    console.error('Error fetching available items:', err);
    res.status(500).json({ error: 'Failed to fetch available items' });
  }
});

// Access a group if owner or member
app.get('/api/groups/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const user = req.user;
    const group = await prisma.friendGroup.findUnique({
      where: { id },
      include: { members: { include: { user: true } }, owner: true },
    });
    if (!group) return res.status(404).json({ error: 'group not found' });
    const isOwner = group.ownerId === user.id;
    const isMember = group.members.some((m) => m.userId === user.id);
    if (!isOwner && !isMember) return res.status(403).json({ error: 'Not allowed' });
    res.json(group);
  } catch (err) {
    console.error('Error fetching group:', err);
    res.status(500).json({ error: 'Failed to fetch group' });
  }
});

// List items shared in a group
app.get('/api/groups/:id/items', authMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const user = req.user;
    const group = await prisma.friendGroup.findUnique({
      where: { id },
      include: { members: true },
    });
    if (!group) return res.status(404).json({ error: 'group not found' });
    const isOwner = group.ownerId === user.id;
    const isMember = group.members.some((m) => m.userId === user.id);
    if (!isOwner && !isMember) return res.status(403).json({ error: 'Not allowed' });

    const shares = await prisma.groupShare.findMany({
      where: { groupId: id },
      include: {
        item: { include: { owner: true, category: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(shares.map((s) => s.item));
  } catch (err) {
    console.error('Error fetching group items:', err);
    res.status(500).json({ error: 'Failed to fetch group items' });
  }
});

// Group chat: list messages
app.get('/api/groups/:id/messages', authMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const user = req.user;
    const group = await prisma.friendGroup.findUnique({
      where: { id },
      include: { members: true },
    });
    if (!group) return res.status(404).json({ error: 'group not found' });
    const isOwner = group.ownerId === user.id;
    const isMember = group.members.some((m) => m.userId === user.id);
    if (!isOwner && !isMember) return res.status(403).json({ error: 'Not allowed' });

    const messages = await prisma.groupMessage.findMany({
      where: { groupId: id },
      include: { author: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    res.json(messages);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Group chat: post message
app.post('/api/groups/:id/messages', authMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'content required' });
  try {
    const user = req.user;
    const group = await prisma.friendGroup.findUnique({
      where: { id },
      include: { members: true },
    });
    if (!group) return res.status(404).json({ error: 'group not found' });
    const isOwner = group.ownerId === user.id;
    const isMember = group.members.some((m) => m.userId === user.id);
    if (!isOwner && !isMember) return res.status(403).json({ error: 'Not allowed' });

    const message = await prisma.groupMessage.create({
      data: { groupId: id, authorId: user.id, content: content.trim() },
      include: { author: true },
    });
    res.status(201).json(message);
  } catch (err) {
    console.error('Error posting message:', err);
    res.status(500).json({ error: 'Failed to post message' });
  }
});

// Share an item to a group (owner-only, must belong to group via owner/membership)
app.post('/api/groups/:id/share', authMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  const { itemId } = req.body;
  if (!itemId) return res.status(400).json({ error: 'itemId required' });
  try {
    const user = req.user;
    const group = await prisma.friendGroup.findUnique({
      where: { id },
      include: { members: true },
    });
    if (!group) return res.status(404).json({ error: 'group not found' });
    const isOwner = group.ownerId === user.id;
    const isMember = group.members.some((m) => m.userId === user.id);
    if (!isOwner && !isMember) return res.status(403).json({ error: 'Not allowed' });

    const item = await prisma.foodItem.findUnique({ where: { id: itemId } });
    if (!item || item.ownerId !== user.id) {
      return res.status(403).json({ error: 'You can share only your own items' });
    }

    await prisma.groupShare.upsert({
      where: { itemId_groupId: { itemId, groupId: id } },
      update: {},
      create: { itemId, groupId: id },
    });

    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('Error sharing item:', err);
    res.status(500).json({ error: 'Failed to share item' });
  }
});

// SPA fallback for any non-API route (Express 5 compatible)
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();

  if (fs.existsSync(CLIENT_DIST)) {
    return res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  }

  return res.json({ message: 'API is running' });
});

const shutdown = async () => {
  console.log('Shutting down server...');
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
