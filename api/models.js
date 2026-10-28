const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  role: { type: String, enum: ['Frontend', 'Backend', 'Full Stack', 'Designer', 'Data/AI', 'Other'], required: true },
  experience: { type: String, enum: ['Beginner', 'Intermediate', 'Advanced'], required: true },
  skills: [String],
  bio: { type: String, default: '' }
}, { timestamps: true });

const teamSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  hackathon: { type: String, required: true, trim: true },
  description: { type: String, required: true },
  maxSize: { type: Number, min: 2, max: 6, required: true },
  techStack: [String],
  lookingFor: [String],
  leader: { type: mongoose.Schema.Types.ObjectId, ref: 'Participant', required: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Participant' }]
}, { timestamps: true });

module.exports = {
  Participant: mongoose.models.Participant || mongoose.model('Participant', participantSchema),
  Team: mongoose.models.Team || mongoose.model('Team', teamSchema)
};
