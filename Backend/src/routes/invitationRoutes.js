import express from 'express';
import { protect, requireVerifiedEmail } from '../middleware/authMiddleware.js';
import validateObjectId from '../middleware/validateObjectId.js';
import validate from '../middleware/validate.js';
import { acceptInvitationSchema } from '../validators/orgValidators.js';
import {
  acceptOrgInvitation,
  acceptOrgInvitationById,
  listMyInvitations,
  previewInvitation,
  rejectOrgInvitation,
  rejectOrgInvitationById,
} from '../controllers/membershipController.js';

const router = express.Router();

// Personal invitation inbox — not scoped to one organization, so it lives on
// its own router mounted at /api/invitations.
router.get('/', protect, listMyInvitations);
router.get('/token/:token', protect, previewInvitation);
router.post('/accept', protect, requireVerifiedEmail, validate(acceptInvitationSchema), acceptOrgInvitation);
router.post('/reject', protect, validate(acceptInvitationSchema), rejectOrgInvitation);

// The inbox lists invitations by id, so the same actions are reachable without
// the raw link. Authorization is still the signed-in address matching the
// invitation, checked in the controller.
router.post('/:id/accept', protect, requireVerifiedEmail, validateObjectId('id'), acceptOrgInvitationById);
router.post('/:id/reject', protect, validateObjectId('id'), rejectOrgInvitationById);

export default router;
