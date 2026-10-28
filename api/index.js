require('dotenv').config();
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const { body, query, validationResult } = require('express-validator');
const { Participant, Team } = require('./models');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Cached connection (needed for serverless on Vercel)
let conn = null;
async function connectDB() {
  if (conn) return conn;
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  conn = mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  await conn;
  return conn;
}
app.use('/api', async (req, res, next) => {
  try { await connectDB(); next(); }
  catch (e) {
  conn = null;
  console.error('MongoDB error:', e.message);
  res.status(500).json({ errors: [{ msg: 'Database connection failed: ' + e.message }] });
}
});

const csv = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
const rxEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const check = (req, res, next) => {
  const r = validationResult(req);
  if (!r.isEmpty()) return res.status(400).json({ errors: r.array().map(e => ({ field: e.path, msg: e.msg })) });
  next();
};

// ---------- Participants ----------
app.get('/api/participants', async (req, res) => {
  const q = {};
  if (req.query.skill) q.skills = new RegExp(rxEsc(req.query.skill), 'i');
  res.json(await Participant.find(q).sort('-createdAt').limit(100));
});

app.post('/api/participants', [
  body('name').trim().isLength({ min: 2, max: 50 }).withMessage('Name must be 2-50 characters')
    .matches(/^[A-Za-z .'-]+$/).withMessage('Name may contain only letters and spaces'),
  body('email').trim().isEmail().withMessage('Enter a valid email').normalizeEmail(),
  body('role').isIn(['Frontend', 'Backend', 'Full Stack', 'Designer', 'Data/AI', 'Other']).withMessage('Select a valid role'),
  body('experience').isIn(['Beginner', 'Intermediate', 'Advanced']).withMessage('Select experience level'),
  body('skills').trim().notEmpty().withMessage('Enter at least one skill (comma separated)'),
  body('bio').optional().isLength({ max: 300 }).withMessage('Bio can be at most 300 characters')
], check, async (req, res) => {
  try {
    if (await Participant.findOne({ email: req.body.email }))
      return res.status(409).json({ errors: [{ field: 'email', msg: 'This email is already registered' }] });
    const p = await Participant.create({ ...req.body, skills: csv(req.body.skills) });
    res.status(201).json(p);
  } catch (e) { res.status(500).json({ errors: [{ msg: 'Could not save participant' }] }); }
});

// ---------- Teams ----------
app.get('/api/teams', async (req, res) => {
  const q = {};
  if (req.query.search) {
    const rx = new RegExp(rxEsc(req.query.search), 'i');
    q.$or = [{ name: rx }, { hackathon: rx }, { techStack: rx }];
  }
  const teams = await Team.find(q).populate('leader members', 'name email role experience skills').sort('-createdAt').lean();
  res.json(teams.map(t => ({ ...t, balance: balance(t.members, t.maxSize) })));
});

app.post('/api/teams', [
  body('name').trim().isLength({ min: 3, max: 40 }).withMessage('Team name must be 3-40 characters'),
  body('hackathon').trim().isLength({ min: 3, max: 60 }).withMessage('Hackathon name must be 3-60 characters'),
  body('description').trim().isLength({ min: 10, max: 500 }).withMessage('Description must be 10-500 characters'),
  body('maxSize').isInt({ min: 2, max: 6 }).withMessage('Team size must be between 2 and 6').toInt(),
  body('techStack').trim().notEmpty().withMessage('Enter at least one technology'),
  body('leaderEmail').trim().isEmail().withMessage("Enter the leader's registered email").normalizeEmail()
], check, async (req, res) => {
  try {
    const leader = await Participant.findOne({ email: req.body.leaderEmail });
    if (!leader) return res.status(404).json({ errors: [{ field: 'leaderEmail', msg: 'Register as a participant first' }] });
    if (await Team.findOne({ name: new RegExp(`^${rxEsc(req.body.name)}$`, 'i') }))
      return res.status(409).json({ errors: [{ field: 'name', msg: 'Team name already taken' }] });
    const t = await Team.create({
      name: req.body.name, hackathon: req.body.hackathon, description: req.body.description,
      maxSize: req.body.maxSize, techStack: csv(req.body.techStack), lookingFor: [].concat(req.body.lookingFor || []), leader: leader._id, members: [leader._id]
    });
    res.status(201).json(t);
  } catch (e) { res.status(500).json({ errors: [{ msg: 'Could not create team' }] }); }
});

app.post('/api/teams/:id/join', [
  body('email').trim().isEmail().withMessage('Enter your registered email').normalizeEmail()
], check, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ errors: [{ msg: 'Invalid team id' }] });
    const team = await Team.findById(req.params.id);
    if (!team) return res.status(404).json({ errors: [{ msg: 'Team not found' }] });
    const user = await Participant.findOne({ email: req.body.email });
    if (!user) return res.status(404).json({ errors: [{ field: 'email', msg: 'Email not registered. Register first.' }] });
    if (team.members.some(m => m.equals(user._id))) return res.status(409).json({ errors: [{ msg: 'You are already in this team' }] });
    if (team.members.length >= team.maxSize) return res.status(409).json({ errors: [{ msg: 'Team is full' }] });
    team.members.push(user._id);
    await team.save();
    res.json({ message: 'Joined successfully' });
  } catch (e) { res.status(500).json({ errors: [{ msg: 'Could not join team' }] }); }
});


// ================= NEW FEATURES =================
const EXP = { Beginner: 1, Intermediate: 2, Advanced: 3 };
const CORE = ['Frontend', 'Backend', 'Designer', 'Data/AI'];

// Feature 1: Team Balance Score (role diversity + experience mix + skill breadth)
function balance(members, maxSize) {
  if (!members.length) return { score: 0, missing: CORE.slice(0, 2) };
  const roles = new Set(members.map(m => m.role));
  const exps = new Set(members.map(m => m.experience));
  const skills = new Set(members.flatMap(m => (m.skills || []).map(x => x.toLowerCase())));
  const raw = (roles.size / members.length) * 45 + Math.min(exps.size / Math.min(3, members.length), 1) * 30 + Math.min(skills.size / 8, 1) * 25;
  const score = Math.round(raw * (0.6 + 0.4 * members.length / maxSize));
  const missing = CORE.filter(r => !roles.has(r) && !roles.has('Full Stack')).slice(0, 2);
  return { score: Math.min(score, 100), missing };
}

// Feature 2: Dashboard stats
app.get('/api/stats', async (req, res) => {
  const [participants, teams] = await Promise.all([Participant.find().lean(), Team.find().populate('members', 'role experience skills').lean()]);
  const roles = {};
  participants.forEach(p => { roles[p.role] = (roles[p.role] || 0) + 1; });
  const scores = teams.map(t => balance(t.members, t.maxSize).score);
  res.json({
    participants: participants.length, teams: teams.length,
    openSpots: teams.reduce((a, t) => a + (t.maxSize - t.members.length), 0),
    hackathons: new Set(teams.map(t => t.hackathon.toLowerCase())).size,
    avgBalance: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
    roles
  });
});

// Feature 3: Smart Match - ranks teams for a participant
app.get('/api/match', [query('email').trim().isEmail().withMessage('Enter a valid email').normalizeEmail()], check, async (req, res) => {
  const me = await Participant.findOne({ email: req.query.email }).lean();
  if (!me) return res.status(404).json({ errors: [{ field: 'email', msg: 'Email not registered. Register first.' }] });
  const mine = me.skills.map(s => s.toLowerCase());
  const teams = await Team.find().populate('members', 'name role experience skills').lean();
  const out = teams
    .filter(t => t.members.length < t.maxSize && !t.members.some(m => String(m._id) === String(me._id)))
    .map(t => {
      const reasons = []; let score = 10;
      const stack = t.techStack.map(s => s.toLowerCase());
      const common = stack.filter(s => mine.some(k => k.includes(s) || s.includes(k)));
      if (stack.length) score += (common.length / stack.length) * 50;
      if (common.length) reasons.push(`Shares ${common.length} tech skill${common.length > 1 ? 's' : ''}: ${common.join(', ')}`);
      if (t.lookingFor.includes(me.role)) { score += 25; reasons.push(`They are looking for a ${me.role}`); }
      if (!t.members.some(m => m.role === me.role)) { score += 10; reasons.push(`You add a new role (${me.role})`); }
      if (!t.members.some(m => m.experience === me.experience)) { score += 5; reasons.push(`Adds ${me.experience} experience mix`); }
      return { team: { ...t, balance: balance(t.members, t.maxSize) }, match: Math.min(Math.round(score), 99), reasons };
    }).sort((a, b) => b.match - a.match).slice(0, 6);
  res.json(out);
});

// Feature 4: Auto Team Builder - balanced teams from unassigned participants
app.post('/api/auto-teams', [
  body('hackathon').trim().isLength({ min: 3, max: 60 }).withMessage('Hackathon name must be 3-60 characters'),
  body('teamSize').isInt({ min: 2, max: 6 }).withMessage('Team size must be 2-6').toInt()
], check, async (req, res) => {
  try {
    const save = req.body.save === true || req.body.save === 'true';
    const size = req.body.teamSize;
    const taken = new Set((await Team.find().select('members').lean()).flatMap(t => t.members.map(String)));
    const pool = (await Participant.find().lean()).filter(p => !taken.has(String(p._id)));
    if (pool.length < 2) return res.status(400).json({ errors: [{ msg: 'Need at least 2 participants without a team' }] });
    pool.sort((a, b) => a.role.localeCompare(b.role) || EXP[b.experience] - EXP[a.experience]);
    const k = Math.ceil(pool.length / size);
    const groups = Array.from({ length: k }, () => []);
    pool.forEach((p, i) => groups[i % k].push(p)); // deal like cards => spreads roles
    const names = ['Alpha', 'Bravo', 'Nova', 'Phoenix', 'Orion', 'Vortex', 'Quantum', 'Zenith'];
    const result = groups.map((g, i) => ({
      name: `Team ${names[i % names.length]} ${Math.floor(100 + Math.random() * 900)}`,
      members: g, balance: balance(g, size)
    }));
    if (save) {
      for (const t of result) {
        const lead = [...t.members].sort((a, b) => EXP[b.experience] - EXP[a.experience])[0];
        const stack = [...new Set(t.members.flatMap(m => m.skills))].slice(0, 4);
        await Team.create({ name: t.name, hackathon: req.body.hackathon, maxSize: size, techStack: stack,
          description: 'Auto-balanced team built by the Smart Team Builder.', leader: lead._id, members: t.members.map(m => m._id) });
      }
    }
    res.json({ saved: save, teams: result });
  } catch (e) { res.status(500).json({ errors: [{ msg: 'Could not build teams' }] }); }
});

// Feature 5: Leave team (leadership passes on; empty team is removed)
app.post('/api/teams/:id/leave', [body('email').trim().isEmail().withMessage('Enter your registered email').normalizeEmail()], check, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ errors: [{ msg: 'Invalid team id' }] });
    const team = await Team.findById(req.params.id);
    const user = await Participant.findOne({ email: req.body.email });
    if (!team) return res.status(404).json({ errors: [{ msg: 'Team not found' }] });
    if (!user || !team.members.some(m => m.equals(user._id))) return res.status(404).json({ errors: [{ field: 'email', msg: 'You are not a member of this team' }] });
    team.members = team.members.filter(m => !m.equals(user._id));
    if (!team.members.length) { await team.deleteOne(); return res.json({ message: 'Team disbanded' }); }
    if (team.leader.equals(user._id)) team.leader = team.members[0];
    await team.save();
    res.json({ message: 'You left the team' });
  } catch (e) { res.status(500).json({ errors: [{ msg: 'Could not leave team' }] }); }
});

module.exports = app;
if (!process.env.VERCEL) app.listen(process.env.PORT || 3000, () => console.log('http://localhost:3000'));
