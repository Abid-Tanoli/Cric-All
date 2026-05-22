import mongoose from 'mongoose';

const seriesSchema = new mongoose.Schema({
  name: { type: String, required: true },
  shortName: String,
  matchType: { type: String, enum: ['Test', 'ODI', 'T20', 'T20I'], default: 'T20' },
  status: { type: String, enum: ['upcoming', 'ongoing', 'completed'], default: 'upcoming' },
  startDate: Date,
  endDate: Date,
  teams: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Team' }],
  venue: String,
  description: String,
  logo: String,
  winner: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' }
}, { timestamps: true });

export default mongoose.model('Series', seriesSchema);