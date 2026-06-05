import Series from '../models/Series.js';
import Match from '../models/Match.js';
import Event from '../models/Event.js';
import mongoose from 'mongoose';

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
    const seriesQuery = mongoose.isValidObjectId(id) ? { _id: id } : { slug: id };
    const series = await Series.findOne(seriesQuery).populate('teams', 'name shortName logo');
    
    if (!series) {
      const eventQuery = mongoose.isValidObjectId(id) ? { _id: id } : { slug: id };
      const event = await Event.findOne(eventQuery)
        .populate('teams', 'name shortName logo')
        .populate('matches')
        .populate('pointsTable.team', 'name shortName logo');
      if (event) {
        const matches = await Match.find({ $or: [{ event: event._id }, { tournament: event._id }] })
          .populate('teams', 'name shortName logo')
          .populate('result.winner', 'name')
          .sort({ startAt: 1 });
        return res.json({
          _id: event._id,
          slug: event.slug,
          name: event.name,
          eventType: event.eventType,
          matchType: event.format || event.category?.name || 'T20',
          format: event.format,
          teams: event.teams || [],
          matches: matches.length ? matches : event.matches || [],
          pointsTable: event.pointsTable || [],
          status: event.status,
          startDate: event.startDate,
          endDate: event.endDate,
          venue: event.venue,
          logo: event.logo,
          totalMatches: event.totalMatches
        });
      }
      return res.status(404).json({ message: 'Series not found' });
    }
    
    const matches = await Match.find({ series: series._id })
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
