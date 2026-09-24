import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  handlerOnly,
  getMyManagedResources,
  getMyRequests,
  createHandlerRequest
} from "../controllers/handlerController.js";

const router = express.Router();

router.get("/my", protect, handlerOnly, getMyManagedResources);
router.get("/requests", protect, handlerOnly, getMyRequests);
router.post("/requests", protect, handlerOnly, createHandlerRequest);

export default router;