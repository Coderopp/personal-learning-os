-- Phase 3.4: cross-mission knowledge links via shared concept tags.
CREATE TABLE concepts (
  id TEXT PRIMARY KEY,          -- normalized slug, e.g. "structured-output"
  name TEXT NOT NULL
);
CREATE TABLE competency_concepts (
  competency_id TEXT NOT NULL,
  concept_id TEXT NOT NULL,
  PRIMARY KEY (competency_id, concept_id)
);
CREATE INDEX competency_concepts_concept ON competency_concepts(concept_id);
