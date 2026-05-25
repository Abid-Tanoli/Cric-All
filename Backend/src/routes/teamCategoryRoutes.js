import express from 'express';
import TeamCategory from '../models/TeamCategory.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const categories = await TeamCategory.find({ isActive: true }).sort({ name: 1 });

    const categoriesWithCounts = await Promise.all(
      categories.map(async (cat) => {
        const { default: Team } = await import('../models/Team.js');
        const teamCount = await Team.countDocuments({ categoryRef: cat._id, isActive: true });
        return { ...cat.toObject(), teamCount };
      })
    );

    res.status(200).json(categoriesWithCounts);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch categories", error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const category = await TeamCategory.create(req.body);
    res.status(201).json({ category, message: "Category created successfully" });
  } catch (error) {
    res.status(400).json({ message: "Failed to create category", error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const category = await TeamCategory.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!category) return res.status(404).json({ message: "Category not found" });
    res.status(200).json({ category, message: "Category updated successfully" });
  } catch (error) {
    res.status(400).json({ message: "Failed to update category", error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { default: Team } = await import('../models/Team.js');
    const teamsExist = await Team.exists({ categoryRef: req.params.id });
    if (teamsExist) {
      return res.status(400).json({ message: "Cannot delete category with existing teams" });
    }
    await TeamCategory.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Category deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete category", error: error.message });
  }
});

export default router;
