const express = require('express');
const router = express.Router();
const { listCourses, cloneStructure, cloneStructureBulk, cloneStructureToTarget, upsertSectionsBatch } = require('../controllers/AdminCoursesController');
const { adminAuth } = require('../middleware/authMiddleware');

// All routes require admin authentication
router.use(adminAuth);

// GET /api/admin/courses
router.get('/', listCourses);

// POST /api/admin/courses/clone-structure (DB-derived)
router.post('/clone-structure', cloneStructure);

// POST /api/admin/courses/clone-structure-bulk (structure provided)
router.post('/clone-structure-bulk', cloneStructureBulk);

// POST /api/admin/courses/:targetId/structure/clone (structure provided)
router.post('/:targetId/structure/clone', cloneStructureToTarget);

// POST /api/admin/courses/:targetId/sections/upsertBatch (per-tab)
router.post('/:targetId/sections/upsertBatch', upsertSectionsBatch);

module.exports = router;
