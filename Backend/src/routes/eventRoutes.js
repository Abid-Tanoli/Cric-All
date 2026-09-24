import express from 'express';
import { protect, requireAdmin } from '../middleware/authMiddleware.js';
import validateObjectId from '../middleware/validateObjectId.js';
import {
  getEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  setEventSquad,
  getEventSquad,
  addMatchToEvent,
  changeEventSquadPlayer,
  toggleEventFeatured
} from '../controllers/eventController.js';

const router = express.Router();
const adminOnly = [protect, requireAdmin];

router.get('/', getEvents);
router.get('/:id', validateObjectId('id'), getEvent);
router.post('/', ...adminOnly, createEvent);
router.post('/:eventId/squad', ...adminOnly, validateObjectId('eventId'), setEventSquad);
router.put('/:eventId/squad/change-player', ...adminOnly, validateObjectId('eventId'), changeEventSquadPlayer);
router.post('/:eventId/matches', ...adminOnly, validateObjectId('eventId'), addMatchToEvent);
router.put('/:id', ...adminOnly, validateObjectId('id'), updateEvent);
router.patch('/:id/featured', ...adminOnly, validateObjectId('id'), toggleEventFeatured);
router.delete('/:id', ...adminOnly, validateObjectId('id'), deleteEvent);
router.get('/:eventId/squad', validateObjectId('eventId'), getEventSquad);
router.get('/:eventId/squad/:teamId', validateObjectId('eventId'), validateObjectId('teamId'), getEventSquad);

export default router;
