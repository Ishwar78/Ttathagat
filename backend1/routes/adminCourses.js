const express = require('express');
const router = express.Router();
const { listCourses, cloneStructure } = require('../controllers/AdminCoursesController');
const { adminAuth } = require('../middleware/authMiddleware');

// All routes require admin authentication
router.use(adminAuth);

// GET /api/admin/courses
router.get('/', listCourses);

// POST /api/admin/courses/clone-structure
router.post('/clone-structure', cloneStructure);

module.exports = router;
