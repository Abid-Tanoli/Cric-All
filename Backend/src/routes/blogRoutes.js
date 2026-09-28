import express from "express";
import { getBlogs, getBlogById, createBlog, updateBlog, deleteBlog } from "../controllers/blogsController.js";
import { protect, requireAdmin, requireVerifiedEmail } from "../middleware/authMiddleware.js";
import validateObjectId from "../middleware/validateObjectId.js";

const router = express.Router();
const adminOnly = [protect, requireAdmin, requireVerifiedEmail];

router.get("/", getBlogs);
router.get("/:id", validateObjectId("id"), getBlogById);
router.post("/", ...adminOnly, createBlog);
router.put("/:id", ...adminOnly, validateObjectId("id"), updateBlog);
router.delete("/:id", ...adminOnly, validateObjectId("id"), deleteBlog);

export default router;
