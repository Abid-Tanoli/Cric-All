import express from 'express';
import { protect, requireAdmin, requireVerifiedEmail } from '../middleware/authMiddleware.js';
import validateObjectId from '../middleware/validateObjectId.js';
import {
  listOrganizations,
  getOrganization,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  getOrganizationTeams,
  getOrganizationTree,
  getRootOrganizations,
  getOrganizationChildren,
  getOrganizationChain,
} from '../controllers/organizationController.js';

const router = express.Router();
const adminOnly = [protect, requireAdmin, requireVerifiedEmail];

router.get('/', listOrganizations);
router.get('/tree', getOrganizationTree);
router.get('/roots', getRootOrganizations);
router.get('/:id', validateObjectId('id'), getOrganization);
router.get('/:id/children', validateObjectId('id'), getOrganizationChildren);
router.get('/:id/chain', validateObjectId('id'), getOrganizationChain);
router.post('/', ...adminOnly, createOrganization);
router.put('/:id', ...adminOnly, validateObjectId('id'), updateOrganization);
router.delete('/:id', ...adminOnly, validateObjectId('id'), deleteOrganization);
router.get('/:id/teams', validateObjectId('id'), getOrganizationTeams);

export default router;
