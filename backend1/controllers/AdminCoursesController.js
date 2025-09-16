const mongoose = require("mongoose");
const Course = require("../models/course/Course");
const Subject = require("../models/course/Subject");
const Chapter = require("../models/course/Chapter");
const Topic = require("../models/course/Topic");

// GET /api/admin/courses?status=active&fields=_id,title
// Supports minimal projection and filters to reduce payload/credits
const listCourses = async (req, res) => {
  try {
    const { status, fields } = req.query;
    const filter = {};
    if (status === "active") filter.isActive = true;
    const projection = {};
    if (fields) {
      fields.split(",").forEach((f) => {
        if (f.trim()) projection[f.trim()] = 1;
      });
    }

    // Normalize title alias for name
    const courses = await Course.find(filter, projection).sort({ createdAt: -1 }).lean();
    const data = courses.map((c) => ({
      _id: c._id,
      title: c.title || c.name,
      name: c.name,
      isActive: c.isActive,
      updatedAt: c.updatedAt,
    }));
    return res.status(200).json({ success: true, courses: data });
  } catch (err) {
    console.error("listCourses error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch courses" });
  }
};

// Utility: find by name else create (for Subject/Chapter/Topic)
async function upsertByName(model, filter, createData) {
  const existing = await model.findOne(filter);
  if (existing) return { doc: existing, created: false };
  const doc = await model.create(createData);
  return { doc, created: true };
}

// POST /api/admin/courses/clone-structure
// Body: { sourceCourseId, targetCourseIds[], includeTabs[], mode:{upsert,skipDuplicates}, idempotencyKey }
const cloneStructure = async (req, res) => {
  try {
    const { sourceCourseId, targetCourseIds, includeTabs, mode } = req.body || {};
    if (!sourceCourseId || !Array.isArray(targetCourseIds) || targetCourseIds.length === 0) {
      return res.status(400).json({ success: false, message: "sourceCourseId and targetCourseIds are required" });
    }

    const includeSet = new Set((includeTabs || []).map((s) => String(s).trim()));

    const sourceCourse = await Course.findById(sourceCourseId);
    if (!sourceCourse) {
      return res.status(404).json({ success: false, message: "Source course not found" });
    }

    const srcSubjects = await Subject.find({ courseId: sourceCourseId }).sort({ order: 1, createdAt: 1 });
    const filteredSubjects = srcSubjects.filter((s) => includeSet.size ? includeSet.has(s.name) : true);
    const srcSubjectIds = filteredSubjects.map((s) => s._id);

    const srcChapters = await Chapter.find({ subjectId: { $in: srcSubjectIds } }).sort({ order: 1, createdAt: 1 });
    const srcChapterIds = srcChapters.map((c) => c._id);
    const srcTopics = await Topic.find({ chapter: { $in: srcChapterIds } }).sort({ order: 1, createdAt: 1 });

    const results = [];
    for (const tgtId of targetCourseIds) {
      if (!tgtId || String(tgtId) === String(sourceCourseId)) {
        results.push({ target: tgtId, skipped: true, reason: "same-as-source" });
        continue;
      }
      const targetCourse = await Course.findById(tgtId);
      if (!targetCourse) {
        results.push({ target: tgtId, skipped: true, reason: "target-not-found" });
        continue;
      }

      let subjectsCreated = 0, chaptersCreated = 0, topicsCreated = 0;

      for (const subj of filteredSubjects) {
        const { doc: tgtSubj, created: subjCreated } = await upsertByName(
          Subject,
          { courseId: tgtId, name: subj.name },
          {
            courseId: tgtId,
            name: subj.name,
            description: subj.description || "",
            order: subj.order || 0,
            isActive: subj.isActive !== false,
          }
        );
        if (subjCreated) subjectsCreated++;

        const subjChapters = srcChapters.filter((c) => String(c.subjectId) === String(subj._id));
        for (const ch of subjChapters) {
          const { doc: tgtChap, created: chapCreated } = await upsertByName(
            Chapter,
            { courseId: tgtId, subjectId: tgtSubj._id, name: ch.name },
            {
              courseId: tgtId,
              subjectId: tgtSubj._id,
              name: ch.name,
              description: ch.description || "",
              order: ch.order || 0,
              isActive: ch.isActive !== false,
            }
          );
          if (chapCreated) chaptersCreated++;

          const chTopics = srcTopics.filter((t) => String(t.chapter) === String(ch._id));
          for (const t of chTopics) {
            const { created: topCreated } = await upsertByName(
              Topic,
              { course: tgtId, subject: tgtSubj._id, chapter: tgtChap._id, name: t.name },
              {
                course: tgtId,
                subject: tgtSubj._id,
                chapter: tgtChap._id,
                name: t.name,
                description: t.description || "",
                order: t.order || 0,
                isFullTestSection: !!t.isFullTestSection,
                isActive: t.isActive !== false,
              }
            );
            if (topCreated) topicsCreated++;
          }
        }
      }

      results.push({ target: tgtId, subjectsCreated, chaptersCreated, topicsCreated });
    }

    const summary = results.reduce(
      (acc, r) => {
        acc.targets += r.skipped ? 0 : 1;
        acc.subjects += r.subjectsCreated || 0;
        acc.chapters += r.chaptersCreated || 0;
        acc.topics += r.topicsCreated || 0;
        return acc;
      },
      { targets: 0, subjects: 0, chapters: 0, topics: 0 }
    );

    return res.status(200).json({ success: true, copied: summary.targets, details: results, created: summary });
  } catch (err) {
    console.error("cloneStructure error:", err);
    return res.status(500).json({ success: false, message: err.message || "Failed to clone structure" });
  }
};

module.exports = { listCourses, cloneStructure };
