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
    // Always include _id and name so clients can display titles correctly
    projection._id = 1;
    projection.name = 1;

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

// Apply provided structure tabs->sections->topics into a target course
async function applyStructureToTarget(tabs, targetCourseId) {
  let subjectsCreated = 0, chaptersCreated = 0, topicsCreated = 0;
  for (const tab of tabs || []) {
    if (!tab || !tab.name) continue;
    const { doc: subj, created: subjCreated } = await upsertByName(
      Subject,
      { courseId: targetCourseId, name: tab.name },
      { courseId: targetCourseId, name: tab.name, description: "", order: 0, isActive: true }
    );
    if (subjCreated) subjectsCreated++;

    const sections = Array.isArray(tab.sections) ? tab.sections : [];
    for (const sec of sections) {
      if (!sec || !sec.title) continue;
      const { doc: chap, created: chapCreated } = await upsertByName(
        Chapter,
        { courseId: targetCourseId, subjectId: subj._id, name: sec.title },
        { courseId: targetCourseId, subjectId: subj._id, name: sec.title, description: "", order: 0, isActive: true }
      );
      if (chapCreated) chaptersCreated++;

      const topics = Array.isArray(sec.topics) ? sec.topics : [];
      for (const top of topics) {
        if (!top || !top.title) continue;
        const { created: topCreated } = await upsertByName(
          Topic,
          { course: targetCourseId, subject: subj._id, chapter: chap._id, name: top.title },
          { course: targetCourseId, subject: subj._id, chapter: chap._id, name: top.title, description: "", order: 0, isFullTestSection: !!top.isFullTestSection, isActive: true }
        );
        if (topCreated) topicsCreated++;
      }
    }
  }
  return { subjectsCreated, chaptersCreated, topicsCreated };
}

// Bulk endpoint that can accept provided structure; if not provided, it falls back to DB-based cloneStructure
const cloneStructureBulk = async (req, res) => {
  try {
    const { sourceCourseId, targetCourseIds, structure } = req.body || {};
    if (!Array.isArray(targetCourseIds) || targetCourseIds.length === 0) {
      return res.status(400).json({ success: false, message: "targetCourseIds required" });
    }

    let tabs = [];
    if (structure && Array.isArray(structure.tabs)) {
      tabs = structure.tabs;
    } else if (sourceCourseId) {
      // Derive from DB if structure not provided
      const srcSubs = await Subject.find({ courseId: sourceCourseId }).sort({ order: 1, createdAt: 1 });
      const subIds = srcSubs.map(s => s._id);
      const srcChaps = await Chapter.find({ subjectId: { $in: subIds } }).sort({ order: 1, createdAt: 1 });
      const chapIds = srcChaps.map(c => c._id);
      const srcTops = await Topic.find({ chapter: { $in: chapIds } }).sort({ order: 1, createdAt: 1 });
      tabs = srcSubs.map(s => ({
        name: s.name,
        sections: srcChaps.filter(c => String(c.subjectId) === String(s._id)).map(c => ({
          title: c.name,
          topics: srcTops.filter(t => String(t.chapter) === String(c._id)).map(t => ({ title: t.name, isFullTestSection: !!t.isFullTestSection }))
        }))
      }));
    } else {
      return res.status(400).json({ success: false, message: "sourceCourseId or structure required" });
    }

    const details = [];
    for (const targetId of targetCourseIds) {
      const target = await Course.findById(targetId);
      if (!target) {
        details.push({ target: targetId, skipped: true, reason: 'target-not-found' });
        continue;
      }
      const r = await applyStructureToTarget(tabs, targetId);
      details.push({ target: targetId, ...r });
    }

    const copied = details.filter(d => !d.skipped).length;
    return res.status(200).json({ success: true, copied, details });
  } catch (err) {
    console.error('cloneStructureBulk error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Bulk clone failed' });
  }
};

// Per-target clone that expects structure in body
const cloneStructureToTarget = async (req, res) => {
  try {
    const { targetId } = req.params;
    const { structure } = req.body || {};
    if (!targetId || !structure || !Array.isArray(structure.tabs)) {
      return res.status(400).json({ success: false, message: 'targetId and structure.tabs required' });
    }
    const target = await Course.findById(targetId);
    if (!target) return res.status(404).json({ success: false, message: 'Target course not found' });
    const r = await applyStructureToTarget(structure.tabs, targetId);
    return res.status(200).json({ success: true, details: r });
  } catch (err) {
    console.error('cloneStructureToTarget error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Clone failed' });
  }
};

// Per-tab upsert sections in a target course
const upsertSectionsBatch = async (req, res) => {
  try {
    const { targetId } = req.params;
    const { tab, sections } = req.body || {};
    if (!targetId || !tab || !Array.isArray(sections)) {
      return res.status(400).json({ success: false, message: 'targetId, tab and sections required' });
    }
    const target = await Course.findById(targetId);
    if (!target) return res.status(404).json({ success: false, message: 'Target course not found' });
    const { doc: subj } = await upsertByName(Subject, { courseId: targetId, name: tab }, { courseId: targetId, name: tab, description: '', order: 0, isActive: true });
    let chaptersCreated = 0, topicsCreated = 0;
    for (const sec of sections) {
      const { doc: chap, created: chapCreated } = await upsertByName(Chapter, { courseId: targetId, subjectId: subj._id, name: sec.title }, { courseId: targetId, subjectId: subj._id, name: sec.title, description: '', order: 0, isActive: true });
      if (chapCreated) chaptersCreated++;
      for (const top of (sec.topics || [])) {
        const { created: topCreated } = await upsertByName(Topic, { course: targetId, subject: subj._id, chapter: chap._id, name: top.title }, { course: targetId, subject: subj._id, chapter: chap._id, name: top.title, description: '', order: 0, isFullTestSection: !!top.isFullTestSection, isActive: true });
        if (topCreated) topicsCreated++;
      }
    }
    return res.status(200).json({ success: true, created: { chaptersCreated, topicsCreated } });
  } catch (err) {
    console.error('upsertSectionsBatch error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Upsert batch failed' });
  }
};

module.exports = { listCourses, cloneStructure, cloneStructureBulk, cloneStructureToTarget, upsertSectionsBatch };
