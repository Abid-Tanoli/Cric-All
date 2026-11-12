import mongoose from 'mongoose';

const seriesSchema = new mongoose.Schema({
  name: { type: String, required: true },
  shortName: String,
  slug: { type: String, index: true },
  matchType: { type: String, enum: ['Test', 'ODI', 'T20', 'T20I'], default: 'T20' },
  status: { type: String, enum: ['upcoming', 'ongoing', 'completed'], default: 'upcoming' },
  startDate: Date,
  endDate: Date,
  teams: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Team' }],
  venue: String,
  description: String,
  logo: String,
  winner: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
  // Phase 2 (org-owned competitions): the organization that owns this series.
  // null means a platform series (Admin-only), and documents written before the
  // field existed stay platform-owned, so no migration is required.
  organizationRef: { type: mongoose.Schema.Types.ObjectId, ref: 'TeamOrganization', default: null }
}, { timestamps: true });

seriesSchema.index({ organizationRef: 1, startDate: -1 });

export default mongoose.model('Series', seriesSchema);
