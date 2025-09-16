import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import AdminLayout from "../AdminLayout/AdminLayout";
import "./CourseStructure.css";
import { toast } from "react-toastify";
import { API_BASE } from "../../../utils/apiBase";

const INCLUDE_TABS = ["Quant", "DI-LR", "Verbal", "GK & CA", "MOCK TEST", "CAT PAPERS"];

const CourseStructure = () => {
  const { courseId } = useParams();
  const [course, setCourse] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [chapters, setChapters] = useState([]);
  const [activeSubject, setActiveSubject] = useState(null);
  const [sendOpen, setSendOpen] = useState(false);
  const token = localStorage.getItem("adminToken");

  useEffect(() => {
    axios
      .get(`/api/courses/${courseId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => setCourse(res.data.course))
      .catch((err) => console.error("Failed to load course:", err));

    axios
      .get(`/api/subjects/${courseId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => {
        setSubjects(res.data.subjects || []);
        if (res.data.subjects?.length > 0) setActiveSubject(res.data.subjects[0]._id);
      })
      .catch((err) => console.error("Failed to load subjects:", err));
  }, [courseId]);

  useEffect(() => {
    if (!activeSubject) return;
    axios
      .get(`/api/chapters/${activeSubject}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => setChapters(res.data.chapters || []))
      .catch((err) => console.error("Failed to load chapters:", err));
  }, [activeSubject]);

  const sourceCourseId = useMemo(() => {
    if (courseId) return courseId;
    const root = document.querySelector('[data-course-id]');
    const fromAttr = root && root.getAttribute('data-course-id');
    return fromAttr || 'cat-2026-structure';
  }, [courseId]);
  const sourceUpdatedAt = useMemo(() => (course && (course.updatedAt || course.updated_at)) || "", [course]);

  // Build structure JSON from window.__tgStructure or DOM
  const activeSubjectIdRef = React.useRef(null);
  useEffect(() => { activeSubjectIdRef.current = activeSubject; }, [activeSubject]);
  const buildStructure = () => {
    if (window.__tgStructure && Array.isArray(window.__tgStructure.tabs)) {
      return { sourceCourseId, tabs: window.__tgStructure.tabs };
    }
    const tabNames = ["Quant", "DI-LR", "Verbal", "GK & CA", "MOCK TEST", "CAT PAPERS"];
    const tabs = tabNames.map((name) => ({ name, sections: [] }));

    try {
      const activeSubj = subjects.find((s) => s._id === activeSubjectIdRef.current);
      const norm = (s) => String(s || '').trim().toLowerCase();
      const activeName = activeSubj ? activeSubj.name : '';
      const idx = tabs.findIndex((t) => norm(t.name) === norm(activeName));
      if (idx >= 0) {
        const sections = chapters.map((ch) => ({ title: ch.name, topics: [] }));
        tabs[idx].sections = sections;
      }
    } catch {}

    try {
      const rows = Array.from(document.querySelectorAll('.tz-chapter-card summary'));
      const titles = rows.map((r) => (r.textContent || '').trim()).filter(Boolean);
      if (titles.length) {
        const qIdx = tabs.findIndex((t) => t.name === 'Quant');
        if (qIdx >= 0 && tabs[qIdx].sections.length === 0) {
          tabs[qIdx].sections = titles.map((t) => ({ title: t }));
        }
      }
    } catch {}

    return { sourceCourseId, tabs };
  };

  return (
    <AdminLayout>
      <div className="tz-container" data-course-id={courseId || ''}>
        <div className="tz-heading-wrap">
          <h1 className="tz-heading">📚 {course?.name} - Structure</h1>
          <button
            id="tg-send-btn"
            type="button"
            className="tz-send-btn"
            aria-label="Send structure to courses"
            onClick={() => setSendOpen(true)}
          >
            Send
          </button>
        </div>

        <div className="tz-subject-tabs">
          {subjects.map((sub) => (
            <button
              key={sub._id}
              onClick={() => setActiveSubject(sub._id)}
              className={`tz-subject-tab ${activeSubject === sub._id ? "active" : ""}`}
            >
              {sub.name}
            </button>
          ))}
        </div>

        {chapters.length > 0 ? (
          <div className="tz-chapters-grid">
            {chapters.map((ch) => (
              <ChapterCard
                key={ch._id}
                chapter={ch}
                course={course}
                subject={subjects.find((s) => s._id === activeSubject)}
              />
            ))}
          </div>
        ) : (
          <div className="tz-no-chapters">No chapters available for this subject.</div>
        )}

        {sendOpen && (
          <SendStructureModal
            open={sendOpen}
            onClose={() => setSendOpen(false)}
            sourceCourseId={sourceCourseId}
            sourceUpdatedAt={sourceUpdatedAt}
          />
        )}
      </div>
    </AdminLayout>
  );
};

const ChapterCard = ({ chapter, course, subject }) => {
  const [topics, setTopics] = useState([]);
  const [expanded, setExpanded] = useState(false);

  const token = localStorage.getItem("adminToken");

  const fetchTopics = () => {
    axios
      .get(`/api/topics/${chapter._id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => setTopics(res.data.topics || []))
      .catch((err) => console.error("❌ Failed to load topics:", err));
  };

  const handleToggle = (e) => {
    setExpanded(e.target.open);
    if (!expanded) fetchTopics();
  };

  return (
    <details className="tz-chapter-card" onToggle={handleToggle}>
      <summary>{chapter.name}</summary>
      <div className="tz-chapter-content">
        <p className="tz-chapter-path">
          Under {course?.name} / {subject?.name}
        </p>

        {topics.length > 0 ? (
          <ul className="tz-topic-list">
            {topics.map((topic) => (
              <li key={topic._id} className="tz-topic-item">
                📗 {topic.name}
                <TestList topicId={topic._id} />
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ fontSize: "12px", color: "#888" }}>No topics found.</p>
        )}
      </div>
    </details>
  );
};

const TestList = ({ topicId }) => {
  const [tests, setTests] = useState([]);
  const [selectedTestId, setSelectedTestId] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const token = localStorage.getItem("adminToken");

  useEffect(() => {
    axios
      .get(`/api/tests/${topicId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => setTests(res.data.tests || []))
      .catch((err) => console.error("❌ Failed to load tests:", err));
  }, [topicId]);

  const openTest = async (testId) => {
    try {
      const res = await axios.get(`/api/questions/${testId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setQuestions(res.data.questions || []);
      setSelectedTestId(testId);
      setShowModal(true);
    } catch (err) {
      console.error("❌ Failed to load questions:", err);
    }
  };

  return (
    <>
      <ul className="tz-test-list">
        {tests.map((test) => (
          <li
            key={test._id}
            className="tz-test-item"
            onClick={() => openTest(test._id)}
          >
            🧪 {test.title}
          </li>
        ))}
      </ul>

      {/* Modal View */}
      {showModal && (
        <div className="tz-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="tz-modal-title">🧪 Questions</h3>
            <button className="tz-modal-close" onClick={() => setShowModal(false)}>
              ❌
            </button>
            <div className="tz-question-scroll">
              {questions.length > 0 ? questions.map((q, idx) => {
                // Safety check for question object
                if (!q || !q._id) {
                  return (
                    <div key={`error-${idx}`} className="tz-question-block">
                      <div className="tz-question-text" style={{color: "#ff6b6b"}}>
                        ⚠️ Question data is malformed
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={q._id} className="tz-question-block">
                    <div className="tz-question-text">
                      <strong>Q{idx + 1}:</strong>{" "}
                      <span dangerouslySetInnerHTML={{ __html: q.questionText || "No question text" }} />
                    </div>
                    {q.image && <img src={`/uploads/${q.image}`} alt="question-img" className="tz-question-image" />}
                    <ul className="tz-options-list">
                      {q.options && typeof q.options === 'object' && !Array.isArray(q.options) ? (
                        // Handle new object-based options format {A: "text", B: "text", ...}
                        Object.entries(q.options).map(([key, value]) => (
                          <li
                            key={key}
                            className={`tz-option-item ${q.correctOption === key ? "correct" : ""}`}
                          >
                            {key}. <span dangerouslySetInnerHTML={{ __html: value || "No option text" }} />
                          </li>
                        ))
                      ) : q.options && Array.isArray(q.options) ? (
                        // Handle legacy array-based options format ["text1", "text2", ...]
                        q.options.map((opt, i) => (
                          <li
                            key={i}
                            className={`tz-option-item ${q.correctOptionIndex === i ? "correct" : ""}`}
                          >
                            {i + 1}. <span dangerouslySetInnerHTML={{ __html: opt || "No option text" }} />
                          </li>
                        ))
                      ) : (
                        <li className="tz-option-item">No options available</li>
                      )}
                    </ul>
                    {q.explanation && (
                      <div className="tz-explanation">
                        <strong>Explanation:</strong>{" "}
                        <span dangerouslySetInnerHTML={{ __html: q.explanation }} />
                      </div>
                    )}
                    {/* Debug info */}
                    <div style={{fontSize: "10px", color: "#888", marginTop: "5px"}}>
                      Difficulty: {q.difficulty || "N/A"} | Marks: {q.marks || "N/A"}
                    </div>
                  </div>
                );
              }) : (
                <div className="tz-no-questions">No questions found for this test.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

function focusableSelectors() {
  return [
    'a[href]','button:not([disabled])','textarea:not([disabled])','input[type="text"]:not([disabled])','input[type="search"]:not([disabled])',
    'input[type="checkbox"]:not([disabled])','select:not([disabled])','[tabindex]:not([tabindex="-1"])'
  ].join(',');
}

const ITEM_HEIGHT = 44;
const VIEWPORT_HEIGHT = 360;

const SendStructureModal = ({ open, onClose, sourceCourseId, sourceUpdatedAt }) => {
  const [loading, setLoading] = useState(false);
  const [courses, setCourses] = useState([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(() => {
    try { return JSON.parse(localStorage.getItem('tg_last_targets')) || []; } catch { return []; }
  });
  const [fetching, setFetching] = useState(false);
  const viewportRef = useRef(null);
  const containerRef = useRef(null);
  const lastActiveRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);

  // Focus trap setup
  useEffect(() => {
    if (!open) return;
    lastActiveRef.current = document.activeElement;
    const modal = containerRef.current;
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Tab') {
        const focusables = modal.querySelectorAll(focusableSelectors());
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    // focus first input
    setTimeout(() => {
      const firstInput = modal.querySelector('input,button');
      firstInput && firstInput.focus();
    }, 0);
    return () => {
      document.removeEventListener('keydown', handleKey);
      if (lastActiveRef.current && lastActiveRef.current.focus) {
        lastActiveRef.current.focus();
      }
    };
  }, [open, onClose]);

  const saveCache = (data) => {
    try {
      localStorage.setItem('tg_courses_cache_v1', JSON.stringify({ ts: Date.now(), data }));
    } catch {}
  };

  const loadFromCache = () => {
    try {
      const raw = localStorage.getItem('tg_courses_cache_v1');
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      if (!ts || !data) return null;
      const TEN_MIN = 10 * 60 * 1000;
      if (Date.now() - ts > TEN_MIN) return null;
      return Array.isArray(data) ? data : null;
    } catch {
      return null;
    }
  };

  // Load courses only when modal opens
  useEffect(() => {
    if (!open) return;
    const cached = loadFromCache();
    if (cached) {
      setCourses(cached);
      return;
    }
    const fetchCourses = async () => {
      setFetching(true);
      try {
        const token = localStorage.getItem('adminToken');
        const urlPrimary = `${API_BASE}/admin/courses?status=active&fields=_id,title,updatedAt&limit=500`;
        const urlFallback = `${API_BASE.replace(/\/$/, '')}/courses`;
        let res = await fetch(urlPrimary, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
          // Try fallback to /api/courses
          res = await fetch(urlFallback, { headers: { Authorization: `Bearer ${token}` } });
        }
        if (!res.ok) throw new Error(`Failed to load courses (${res.status})`);
        const data = await res.json();
        const list = data.courses || data.data || data || [];
        let normalized = list.map((c) => ({ _id: c._id || c.id, title: c.title || c.name || '' })).filter(x => x._id);
        // If titles are missing, fetch fallback endpoint and merge names
        if (normalized.some(x => !x.title)) {
          try {
            const fb = await fetch(urlFallback, { headers: { Authorization: `Bearer ${token}` } });
            if (fb.ok) {
              const fbData = await fb.json();
              const fbList = (fbData.courses || fbData.data || fbData || []).map(c => ({ _id: c._id || c.id, title: c.title || c.name || '' }));
              const nameMap = new Map(fbList.map(c => [String(c._id), c.title]));
              normalized = normalized.map(c => ({ _id: c._id, title: c.title || nameMap.get(String(c._id)) || 'Untitled' }));
            } else {
              normalized = normalized.map(c => ({ _id: c._id, title: c.title || 'Untitled' }));
            }
          } catch {
            normalized = normalized.map(c => ({ _id: c._id, title: c.title || 'Untitled' }));
          }
        }
        setCourses(normalized);
        saveCache(normalized);
      } catch (e) {
        toast.error(e.message || 'Failed to load courses');
      } finally {
        setFetching(false);
      }
    };
    fetchCourses();
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter(c => (c.title || '').toLowerCase().includes(q) || (c._id || '').toLowerCase().includes(q));
  }, [courses, query]);

  const totalHeight = useMemo(() => filtered.length * ITEM_HEIGHT, [filtered.length]);
  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - 5);
  const endIndex = Math.min(filtered.length, startIndex + Math.ceil(VIEWPORT_HEIGHT / ITEM_HEIGHT) + 10);
  const visibleItems = filtered.slice(startIndex, endIndex);
  const offsetY = startIndex * ITEM_HEIGHT;

  const toggle = (id) => {
    setSelected((prev) => {
      const set = new Set(prev);
      if (set.has(id)) set.delete(id); else set.add(id);
      const arr = Array.from(set);
      try { localStorage.setItem('tg_last_targets', JSON.stringify(arr)); } catch {}
      return arr;
    });
  };

  const allFilteredIds = useMemo(() => filtered.map(c => c._id), [filtered]);
  const allSelectedOnFiltered = allFilteredIds.every(id => selected.includes(id)) && allFilteredIds.length > 0;

  const toggleAll = () => {
    setSelected((prev) => {
      let next;
      if (allSelectedOnFiltered) {
        const s = new Set(prev);
        allFilteredIds.forEach(id => s.delete(id));
        next = Array.from(s);
      } else {
        next = Array.from(new Set([...prev, ...allFilteredIds]));
      }
      try { localStorage.setItem('tg_last_targets', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const sha256 = async (text) => {
    const enc = new TextEncoder().encode(text);
    const buf = await window.crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  };

  // Build structure using global cache or DOM when modal is open
  const buildStructure = () => {
    if (window.__tgStructure && Array.isArray(window.__tgStructure.tabs)) {
      return { sourceCourseId, tabs: window.__tgStructure.tabs };
    }
    const tabButtons = Array.from(document.querySelectorAll('.tz-subject-tabs .tz-subject-tab'));
    const tabNames = tabButtons.length ? tabButtons.map(b => (b.textContent || '').trim()) : ["Quant","DI-LR","Verbal","GK & CA","MOCK TEST","CAT PAPERS"];
    const tabs = tabNames.map(name => ({ name, sections: [] }));

    // Determine active tab
    const activeBtn = document.querySelector('.tz-subject-tabs .tz-subject-tab.active');
    const activeName = activeBtn ? (activeBtn.textContent || '').trim() : (tabNames[0] || 'Quant');

    // Gather section rows and their topics (if visible)
    const summaryEls = Array.from(document.querySelectorAll('.tz-chapter-card summary'));
    const sectionsForActive = summaryEls.map((summary) => {
      const title = (summary.textContent || '').trim();
      const details = summary.closest('.tz-chapter-card');
      let topics = [];
      if (details) {
        const topicEls = Array.from(details.querySelectorAll('.tz-topic-item'));
        if (topicEls.length) {
          topics = topicEls.map((el) => {
            const raw = (el.childNodes[0] && el.childNodes[0].textContent) || el.textContent || '';
            const clean = raw.trim().replace(/^📗\s*/, '');
            return { title: clean };
          });
        }
      }
      return title ? { title, topics } : null;
    }).filter(Boolean);

    const idx = tabs.findIndex(t => t.name === activeName);
    if (idx >= 0 && sectionsForActive.length) tabs[idx].sections = sectionsForActive;

    return { sourceCourseId, tabs };
  };

  const tabsHash = async (structure) => {
    const base = JSON.stringify(structure.tabs || []);
    return sha256(base);
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const handleSend = async () => {
    if (!selected.length) {
      toast.info('Please select at least one course');
      return;
    }
    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      const targets = [...selected].sort();
      const structure = buildStructure();
      const th = await tabsHash(structure);
      const idempotencyKey = await sha256(`${structure.sourceCourseId}|${targets.join(',')}|${th}`);

      const body = {
        sourceCourseId: structure.sourceCourseId,
        targetCourseIds: targets,
        structure,
        mode: { upsert: true, skipDuplicates: true }
      };

      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': idempotencyKey };

      // Try bulk first with retries
      let attempts = 0; let maxAttempts = 3; let res;
      while (attempts < maxAttempts) {
        attempts++;
        try {
          res = await fetch(`${API_BASE}/admin/courses/clone-structure-bulk`, { method: 'POST', headers, body: JSON.stringify(body) });
          if (res.status === 404 || res.status === 501) throw new Error('bulk-not-supported');
          if (!res.ok) throw new Error(await res.text() || `Status ${res.status}`);
          break;
        } catch (err) {
          if (attempts >= maxAttempts || err.message === 'bulk-not-supported') {
            res = null;
            break;
          }
          await sleep(400 * attempts);
        }
      }

      if (!res) {
        // Fallback per-course
        let okCount = 0; let lastErr = null;
        for (const tid of targets) {
          let a = 0; let success = false;
          while (a < maxAttempts && !success) {
            a++;
            try {
              const r = await fetch(`${API_BASE}/admin/courses/${tid}/structure/clone`, { method: 'POST', headers, body: JSON.stringify({ structure, mode: { upsert: true, skipDuplicates: true } }) });
              if (r.status === 404 || r.status === 501) {
                // Final fallback per tab
                for (const tab of structure.tabs || []) {
                  const r2 = await fetch(`${API_BASE}/admin/courses/${tid}/sections/upsertBatch`, { method: 'POST', headers, body: JSON.stringify({ tab: tab.name, sections: tab.sections || [] }) });
                  if (!r2.ok) throw new Error(await r2.text() || `Tab ${tab.name} failed`);
                }
              } else if (!r.ok) {
                throw new Error(await r.text() || `Status ${r.status}`);
              }
              success = true; okCount++;
            } catch (e) {
              lastErr = e;
              await sleep(400 * a);
            }
          }
        }
        if (!okCount) throw lastErr || new Error('Failed to clone structure');
        toast.success(`Structure copied/updated in ${okCount} courses`);
        onClose();
        return;
      }

      const data = await res.json();
      const n = data.copied || (data.details ? data.details.filter(d => !d.skipped).length : 0) || selected.length;
      toast.success(`Structure copied/updated in ${n} courses`);
      onClose();
    } catch (e) {
      toast.error(e.message || 'Failed to send structure');
    } finally {
      setLoading(false);
    }
  };

  return open ? (
    <div id="tg-send-modal" className="tz-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="send-structure-title" onClick={onClose}>
      <div className="tz-modal" ref={containerRef} onClick={(e) => e.stopPropagation()}>
        <h3 id="send-structure-title" className="tz-modal-title">Send structure to courses</h3>
        <div className="tz-send-controls">
          <input
            id="tg-course-search"
            type="search"
            className="tz-send-search"
            placeholder="Search courses…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search courses"
          />
          <label className="tz-select-all-row">
            <input id="tg-select-all" type="checkbox" checked={allSelectedOnFiltered} onChange={toggleAll} />
            <span>Select all</span>
          </label>
        </div>

        <div
          id="tg-course-list"
          className="tz-course-list-viewport"
          ref={viewportRef}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          style={{ height: VIEWPORT_HEIGHT }}
          role="listbox"
          aria-multiselectable="true"
        >
          <div style={{ height: totalHeight, position: 'relative' }}>
            <div style={{ position: 'absolute', top: offsetY, left: 0, right: 0 }}>
              {visibleItems.map((c) => (
                <label key={c._id} className="tz-course-row" role="option" aria-selected={selected.includes(c._id)}>
                  <input
                    type="checkbox"
                    checked={selected.includes(c._id)}
                    onChange={() => toggle(c._id)}
                    aria-label={`Select course ${c.title}`}
                  />
                  <span className="tz-course-title">{c.title}</span>
                  <span className="tz-course-id">{c._id}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="tz-modal-footer">
          <button type="button" className="tz-btn-secondary" onClick={onClose} disabled={loading}>Cancel</button>
          <button
            id="tg-send-confirm"
            type="button"
            className="tz-btn-primary"
            onClick={handleSend}
            disabled={loading || fetching}
            aria-label="Send structure to selected courses"
          >
            {loading ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  ) : null;
};

export default CourseStructure;
