import Series from '../models/Series.js';
import Match from '../models/Match.js';

export const getSeries = async (req, res) => {
  try {
    const series = await Series.find()
      .populate('teams', 'name shortName logo')
      .sort({ startDate: -1 });
    res.json(series);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getSeriesById = async (req, res) => {
  try {
    const { id } = req.params;
    const series = await Series.findById(id).populate('teams', 'name shortName logo');
    
    if (!series) {
      const event = await import('../models/Event.js').then(m => m.default.findById(id));
      if (event) {
        const matches = await Match.find({ event: id })
          .populate('teams', 'name shortName logo')
          .populate('result.winner', 'name')
          .sort({ startAt: 1 });
        return res.json({
          _id: event._id,
          name: event.name,
          matchType: event.category?.name || 'T20',
          teams: event.teams || [],
          matches: matches,
          status: event.status
        });
      }
      return res.status(404).json({ message: 'Series not found' });
    }
    
    const matches = await Match.find({ series: id })
      .populate('teams', 'name shortName logo')
      .populate('result.winner', 'name')
      .sort({ startAt: 1 });
    
    res.json({ ...series.toObject(), matches });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createSeries = async (req, res) => {
  try {
    const series = new Series(req.body);
    await series.save();
    res.status(201).json(series);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const updateSeries = async (req, res) => {
  try {
    const series = await Series.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(series);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const deleteSeries = async (req, res) => {
  try {
    await Series.findByIdAndDelete(req.params.id);
    res.json({ message: 'Series deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};