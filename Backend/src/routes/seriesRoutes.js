import express from 'express';
import { 
  getSeries, 
  getSeriesById, 
  createSeries, 
  updateSeries, 
  deleteSeries 
} from '../controllers/seriesController.js';
import { protect, requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', getSeries);
router.get('/:id', getSeriesById);
router.post('/', protect, requireAdmin, createSeries);
router.put('/:id', protect, requireAdmin, updateSeries);
router.delete('/:id', protect, requireAdmin, deleteSeries);

export default router;