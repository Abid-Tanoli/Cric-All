import express from 'express';
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

router.get('/', listOrganizations);
router.get('/tree', getOrganizationTree);
router.get('/roots', getRootOrganizations);
router.get('/:id', getOrganization);
router.get('/:id/children', getOrganizationChildren);
router.get('/:id/chain', getOrganizationChain);
router.post('/', createOrganization);
router.put('/:id', updateOrganization);
router.delete('/:id', deleteOrganization);
router.get('/:id/teams', getOrganizationTeams);

export default router;
