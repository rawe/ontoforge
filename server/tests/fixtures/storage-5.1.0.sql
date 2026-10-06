-- Storage of OntoForge 5.1.0 — the last release of the 5.x line, which has no
-- storage version (version 1). Produced by the v5.1.0 server (git tag v5.1.0)
-- on PostgreSQL 18 with pgvector 0.8.6 and an embedding provider of width 1024:
-- two ontologies created and filled through its API (a 5.0 design import, data
-- writes, and one entity type built property by property), then
--   pg_dump --no-owner --no-privileges --column-inserts -t public.ontology
--   pg_dump --no-owner --no-privileges --column-inserts -n <both namespaces>
-- The only edits: session SET lines and psql meta-commands removed, the
-- namespaces and keys renamed (fx_legacy_mix -> legacy, fx_legacy_de ->
-- legacy_de), and every stored vector replaced by NULL to keep the file small
-- (the per-type vector indexes stay). Never regenerate it with a newer
-- release: it is the frozen layout the 6.0 storage upgrade starts from
-- (tests/integration/postgres/storage-version.test.ts).

CREATE TABLE public.ontology (
    ontology_id uuid NOT NULL,
    key text NOT NULL,
    display_name text,
    text_search_language text NOT NULL,
    namespace text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ontology_text_search_language_check CHECK ((text_search_language = ANY (ARRAY['english'::text, 'german'::text])))
);

INSERT INTO public.ontology (ontology_id, key, display_name, text_search_language, namespace, created_at, updated_at) VALUES ('b11ec46e-cad5-4922-8646-92092ba0d170', 'legacy', NULL, 'english', 'ont_legacy', '2026-10-06 06:23:35.48212+00', '2026-10-06 06:23:35.48212+00');
INSERT INTO public.ontology (ontology_id, key, display_name, text_search_language, namespace, created_at, updated_at) VALUES ('abd092b6-d53e-43c6-a6ac-14615146b66f', 'legacy_de', NULL, 'german', 'ont_legacy_de', '2026-10-06 06:23:36.259498+00', '2026-10-06 06:23:36.259498+00');

ALTER TABLE ONLY public.ontology
    ADD CONSTRAINT ontology_display_name_unique UNIQUE (display_name);

ALTER TABLE ONLY public.ontology
    ADD CONSTRAINT ontology_key_unique UNIQUE (key);

ALTER TABLE ONLY public.ontology
    ADD CONSTRAINT ontology_pk PRIMARY KEY (ontology_id);

CREATE SCHEMA ont_legacy_de;

CREATE SCHEMA ont_legacy;

CREATE TABLE ont_legacy_de.ai_agent_config (
    agent_config_id uuid NOT NULL,
    lens_id uuid NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    description text,
    system_prompt text,
    tools text[],
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ont_legacy_de.document_chunk (
    id uuid NOT NULL,
    entity_id uuid NOT NULL,
    entity_type_key text NOT NULL,
    property_key text NOT NULL,
    chunk_index integer NOT NULL,
    start_char integer NOT NULL,
    char_length integer NOT NULL,
    text text NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('german'::regconfig, text)) STORED,
    embedding public.vector
);

CREATE TABLE ont_legacy_de.entity (
    id uuid NOT NULL,
    type_key text CONSTRAINT entity_type_key_not_null1 NOT NULL,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    property_text text DEFAULT ''::text NOT NULL,
    keyword_text text DEFAULT ''::text NOT NULL,
    keyword_segments jsonb,
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('german'::regconfig, keyword_text)) STORED,
    embedding public.vector,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ont_legacy_de.entity_type (
    entity_type_id uuid NOT NULL,
    key text NOT NULL,
    display_name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ont_legacy_de.lens (
    lens_id uuid NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ont_legacy_de.lens_includes (
    lens_id uuid NOT NULL,
    entity_type_id uuid,
    relation_type_id uuid,
    properties text[],
    CONSTRAINT lens_includes_one_type CHECK ((num_nonnulls(entity_type_id, relation_type_id) = 1))
);

CREATE TABLE ont_legacy_de.property_def (
    property_id uuid NOT NULL,
    entity_type_id uuid,
    relation_type_id uuid,
    key text NOT NULL,
    display_name text NOT NULL,
    description text,
    data_type text NOT NULL,
    required boolean NOT NULL,
    default_value text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT property_def_one_owner CHECK ((num_nonnulls(entity_type_id, relation_type_id) = 1))
);

CREATE TABLE ont_legacy_de.relation (
    id uuid NOT NULL,
    type_key text CONSTRAINT relation_type_key_not_null1 NOT NULL,
    from_id uuid NOT NULL,
    to_id uuid NOT NULL,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ont_legacy_de.relation_type (
    relation_type_id uuid NOT NULL,
    key text NOT NULL,
    display_name text NOT NULL,
    description text,
    source_entity_type_key text NOT NULL,
    target_entity_type_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ont_legacy_de.saved_query (
    saved_query_id uuid NOT NULL,
    lens_id uuid NOT NULL,
    lens_key text,
    key text NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    steps text NOT NULL,
    parameters text NOT NULL,
    embedding public.vector,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ont_legacy.ai_agent_config (
    agent_config_id uuid NOT NULL,
    lens_id uuid NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    description text,
    system_prompt text,
    tools text[],
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ont_legacy.document_chunk (
    id uuid NOT NULL,
    entity_id uuid NOT NULL,
    entity_type_key text NOT NULL,
    property_key text NOT NULL,
    chunk_index integer NOT NULL,
    start_char integer NOT NULL,
    char_length integer NOT NULL,
    text text NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, text)) STORED,
    embedding public.vector
);

CREATE TABLE ont_legacy.entity (
    id uuid NOT NULL,
    type_key text CONSTRAINT entity_type_key_not_null1 NOT NULL,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    property_text text DEFAULT ''::text NOT NULL,
    keyword_text text DEFAULT ''::text NOT NULL,
    keyword_segments jsonb,
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, keyword_text)) STORED,
    embedding public.vector,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ont_legacy.entity_type (
    entity_type_id uuid NOT NULL,
    key text NOT NULL,
    display_name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ont_legacy.lens (
    lens_id uuid NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ont_legacy.lens_includes (
    lens_id uuid NOT NULL,
    entity_type_id uuid,
    relation_type_id uuid,
    properties text[],
    CONSTRAINT lens_includes_one_type CHECK ((num_nonnulls(entity_type_id, relation_type_id) = 1))
);

CREATE TABLE ont_legacy.property_def (
    property_id uuid NOT NULL,
    entity_type_id uuid,
    relation_type_id uuid,
    key text NOT NULL,
    display_name text NOT NULL,
    description text,
    data_type text NOT NULL,
    required boolean NOT NULL,
    default_value text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT property_def_one_owner CHECK ((num_nonnulls(entity_type_id, relation_type_id) = 1))
);

CREATE TABLE ont_legacy.relation (
    id uuid NOT NULL,
    type_key text CONSTRAINT relation_type_key_not_null1 NOT NULL,
    from_id uuid NOT NULL,
    to_id uuid NOT NULL,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ont_legacy.relation_type (
    relation_type_id uuid NOT NULL,
    key text NOT NULL,
    display_name text NOT NULL,
    description text,
    source_entity_type_key text NOT NULL,
    target_entity_type_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ont_legacy.saved_query (
    saved_query_id uuid NOT NULL,
    lens_id uuid NOT NULL,
    lens_key text,
    key text NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    steps text NOT NULL,
    parameters text NOT NULL,
    embedding public.vector,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

INSERT INTO ont_legacy_de.ai_agent_config (agent_config_id, lens_id, key, name, description, system_prompt, tools, created_at, updated_at) VALUES ('76ca630e-971c-4037-9cc5-c4311cebd657', 'cbde333d-7d64-457e-9d1b-8005c1800c27', 'kurzhilfe', 'Kurzhilfe', NULL, 'Antworte kurz.', NULL, '2026-10-06 06:23:36.318752+00', '2026-10-06 06:23:36.318752+00');

INSERT INTO ont_legacy_de.document_chunk (id, entity_id, entity_type_key, property_key, chunk_index, start_char, char_length, text, embedding) VALUES ('00e5e1dd-188b-4194-800c-2210d538efa7', '6825c25f-028f-42d2-953d-9c4f1b08bf84', 'dokument', 'inhalt', 0, 0, 70, 'Der Mieter zahlt die Miete monatlich. Die Wohnungen liegen in Hamburg.', NULL);

INSERT INTO ont_legacy_de.entity (id, type_key, props, property_text, keyword_text, keyword_segments, embedding, created_at, updated_at) VALUES ('6825c25f-028f-42d2-953d-9c4f1b08bf84', 'dokument', '{"titel": "Mietvertrag", "inhalt": "Der Mieter zahlt die Miete monatlich. Die Wohnungen liegen in Hamburg.", "seiten": 4, "_doc_inhalt_length": 70}', 'dokument: titel=Mietvertrag', 'Mietvertrag', '[{"text": "Mietvertrag", "propertyKey": "titel"}]', NULL, '2026-10-06 06:23:36.349882+00', '2026-10-06 06:23:36.349882+00');
INSERT INTO ont_legacy_de.entity (id, type_key, props, property_text, keyword_text, keyword_segments, embedding, created_at, updated_at) VALUES ('b1396a21-d43f-483e-8664-c73a2ef20f5a', 'dokument', '{"titel": "Hausordnung"}', 'dokument: titel=Hausordnung', 'Hausordnung', '[{"text": "Hausordnung", "propertyKey": "titel"}]', NULL, '2026-10-06 06:23:36.39204+00', '2026-10-06 06:23:36.39204+00');
INSERT INTO ont_legacy_de.entity (id, type_key, props, property_text, keyword_text, keyword_segments, embedding, created_at, updated_at) VALUES ('97ef230b-ab99-429c-9dda-20820893279d', 'ort', '{"bezeichnung": "Hamburg"}', 'ort: bezeichnung=Hamburg', 'Hamburg', '[{"text": "Hamburg", "propertyKey": "bezeichnung"}]', NULL, '2026-10-06 06:23:36.411099+00', '2026-10-06 06:23:36.411099+00');

INSERT INTO ont_legacy_de.entity_type (entity_type_id, key, display_name, description, created_at, updated_at) VALUES ('99ec23ac-200b-49da-9e0b-0e25808ab0f3', 'dokument', 'Dokument', NULL, '2026-10-06 06:23:36.294246+00', '2026-10-06 06:23:36.294246+00');
INSERT INTO ont_legacy_de.entity_type (entity_type_id, key, display_name, description, created_at, updated_at) VALUES ('c1b6748c-c834-42b5-a79c-928c8c1f21ae', 'ort', 'Ort', NULL, '2026-10-06 06:23:36.30546+00', '2026-10-06 06:23:36.30546+00');

INSERT INTO ont_legacy_de.lens (lens_id, key, name, description, created_at, updated_at) VALUES ('eafaeb1f-5500-4232-a046-bbdbfdf8babe', 'alles', 'Alles', NULL, '2026-10-06 06:23:36.312339+00', '2026-10-06 06:23:36.312339+00');
INSERT INTO ont_legacy_de.lens (lens_id, key, name, description, created_at, updated_at) VALUES ('cbde333d-7d64-457e-9d1b-8005c1800c27', 'kurz', 'Kurz', 'Dokumente ohne Inhalt', '2026-10-06 06:23:36.313906+00', '2026-10-06 06:23:36.313906+00');

INSERT INTO ont_legacy_de.lens_includes (lens_id, entity_type_id, relation_type_id, properties) VALUES ('cbde333d-7d64-457e-9d1b-8005c1800c27', '99ec23ac-200b-49da-9e0b-0e25808ab0f3', NULL, '{titel}');
INSERT INTO ont_legacy_de.lens_includes (lens_id, entity_type_id, relation_type_id, properties) VALUES ('cbde333d-7d64-457e-9d1b-8005c1800c27', 'c1b6748c-c834-42b5-a79c-928c8c1f21ae', NULL, NULL);
INSERT INTO ont_legacy_de.lens_includes (lens_id, entity_type_id, relation_type_id, properties) VALUES ('cbde333d-7d64-457e-9d1b-8005c1800c27', NULL, '3cda1c16-29c1-4dd8-89a0-0352f5df0288', NULL);

INSERT INTO ont_legacy_de.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('0f8b8540-9f59-459e-932a-c60bac3a9436', '99ec23ac-200b-49da-9e0b-0e25808ab0f3', NULL, 'titel', 'Titel', NULL, 'string', true, NULL, '2026-10-06 06:23:36.295904+00', '2026-10-06 06:23:36.295904+00');
INSERT INTO ont_legacy_de.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('dcd08d93-5732-4d98-a445-6716117a8ba4', '99ec23ac-200b-49da-9e0b-0e25808ab0f3', NULL, 'inhalt', 'Inhalt', NULL, 'document', false, NULL, '2026-10-06 06:23:36.298672+00', '2026-10-06 06:23:36.298672+00');
INSERT INTO ont_legacy_de.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('ccbd2e1e-31dd-4624-b1e3-c3209c961223', '99ec23ac-200b-49da-9e0b-0e25808ab0f3', NULL, 'seiten', 'Seiten', NULL, 'integer', false, NULL, '2026-10-06 06:23:36.299858+00', '2026-10-06 06:23:36.299858+00');
INSERT INTO ont_legacy_de.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('51ccc30c-35f5-42e1-b60d-a774a1334892', 'c1b6748c-c834-42b5-a79c-928c8c1f21ae', NULL, 'bezeichnung', 'Bezeichnung', NULL, 'string', true, NULL, '2026-10-06 06:23:36.306576+00', '2026-10-06 06:23:36.306576+00');
INSERT INTO ont_legacy_de.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('19d5c214-1593-4ac7-8da3-e1f1fddbc844', NULL, '3cda1c16-29c1-4dd8-89a0-0352f5df0288', 'seite', 'Seite', NULL, 'integer', false, NULL, '2026-10-06 06:23:36.311158+00', '2026-10-06 06:23:36.311158+00');

INSERT INTO ont_legacy_de.relation (id, type_key, from_id, to_id, props, created_at, updated_at) VALUES ('23452d04-f937-4b54-b5bd-6bc401e58089', 'erwaehnt', '6825c25f-028f-42d2-953d-9c4f1b08bf84', '97ef230b-ab99-429c-9dda-20820893279d', '{"seite": 2}', '2026-10-06 06:23:36.419634+00', '2026-10-06 06:23:36.419634+00');

INSERT INTO ont_legacy_de.relation_type (relation_type_id, key, display_name, description, source_entity_type_key, target_entity_type_key, created_at, updated_at) VALUES ('3cda1c16-29c1-4dd8-89a0-0352f5df0288', 'erwaehnt', 'Erwähnt', NULL, 'dokument', 'ort', '2026-10-06 06:23:36.3098+00', '2026-10-06 06:23:36.3098+00');

INSERT INTO ont_legacy.ai_agent_config (agent_config_id, lens_id, key, name, description, system_prompt, tools, created_at, updated_at) VALUES ('9596bc67-32fc-4ae2-bed6-0b032af04803', 'fac888f4-9e71-4c92-8ebf-f9888d7dc33e', 'helper', 'Helper', 'Answers about articles', 'Be brief.', NULL, '2026-10-06 06:23:35.576479+00', '2026-10-06 06:23:35.576479+00');
INSERT INTO ont_legacy.ai_agent_config (agent_config_id, lens_id, key, name, description, system_prompt, tools, created_at, updated_at) VALUES ('e257c880-4ed9-40eb-ad6a-f60d0c0674f4', '9c599f4d-0ad7-45b6-9a7c-441705916cad', 'brief_agent', 'Brief agent', NULL, NULL, '{search}', '2026-10-06 06:23:35.624494+00', '2026-10-06 06:23:35.624494+00');

INSERT INTO ont_legacy.document_chunk (id, entity_id, entity_type_key, property_key, chunk_index, start_char, char_length, text, embedding) VALUES ('bea182f7-8429-45d7-90d9-2de0f724399d', 'cc8ed390-8178-41c0-93ca-1690d74339da', 'article', 'body', 0, 0, 505, 'Graph databases store entities and relations. Graph databases store entities and relations. Graph databases store entities and relations. Vector search finds passages by meaning; keyword search finds them by words. Vector search finds passages by meaning; keyword search finds them by words. Vector search finds passages by meaning; keyword search finds them by words. Vector search finds passages by meaning; keyword search finds them by words. PostgreSQL with pgvector keeps embeddings next to the data.', NULL);
INSERT INTO ont_legacy.document_chunk (id, entity_id, entity_type_key, property_key, chunk_index, start_char, char_length, text, embedding) VALUES ('44378849-e8ef-440c-91c2-4b7326541697', 'f1c64570-2384-4daa-a37a-289d06ba0d1a', 'article', 'body', 0, 0, 83, 'Stemming reduces words to their stems. Running, runs and ran become run in English.', NULL);
INSERT INTO ont_legacy.document_chunk (id, entity_id, entity_type_key, property_key, chunk_index, start_char, char_length, text, embedding) VALUES ('2d9e98b3-eb98-4ca7-869d-5fb471e335b9', 'e0e7fbcb-c1bf-4591-8467-1163a94b177c', 'memo', 'body', 0, 0, 57, 'Remember to rebuild the search indices after the upgrade.', NULL);
INSERT INTO ont_legacy.document_chunk (id, entity_id, entity_type_key, property_key, chunk_index, start_char, char_length, text, embedding) VALUES ('9f3379f1-a1cb-456b-bb66-72e0ce3682ad', 'afdb15b5-70dc-48f3-82cc-ac265f324f42', 'ticket', 'notes', 0, 0, 56, 'The login page throws an error after the password reset.', NULL);

INSERT INTO ont_legacy.entity (id, type_key, props, property_text, keyword_text, keyword_segments, embedding, created_at, updated_at) VALUES ('cc8ed390-8178-41c0-93ca-1690d74339da', 'article', '{"body": "Graph databases store entities and relations. Graph databases store entities and relations. Graph databases store entities and relations. Vector search finds passages by meaning; keyword search finds them by words. Vector search finds passages by meaning; keyword search finds them by words. Vector search finds passages by meaning; keyword search finds them by words. Vector search finds passages by meaning; keyword search finds them by words. PostgreSQL with pgvector keeps embeddings next to the data.", "label": "basics", "title": "Graph storage basics", "summary": "How graphs are stored", "word_count": 420, "published_on": "2026-01-15", "_doc_body_length": 505}', 'article: label=basics, summary=How graphs are stored, title=Graph storage basics', 'basics
How graphs are stored
Graph storage basics', '[{"text": "basics", "propertyKey": "label"}, {"text": "How graphs are stored", "propertyKey": "summary"}, {"text": "Graph storage basics", "propertyKey": "title"}]', NULL, '2026-10-06 06:23:35.666352+00', '2026-10-06 06:23:35.666352+00');
INSERT INTO ont_legacy.entity (id, type_key, props, property_text, keyword_text, keyword_segments, embedding, created_at, updated_at) VALUES ('f1c64570-2384-4daa-a37a-289d06ba0d1a', 'article', '{"body": "Stemming reduces words to their stems. Running, runs and ran become run in English.", "label": "search", "title": "Keyword stemming", "summary": "Stemming in full text search", "word_count": 120, "published_on": "2026-03-02", "_doc_body_length": 83}', 'article: label=search, summary=Stemming in full text search, title=Keyword stemming', 'search
Stemming in full text search
Keyword stemming', '[{"text": "search", "propertyKey": "label"}, {"text": "Stemming in full text search", "propertyKey": "summary"}, {"text": "Keyword stemming", "propertyKey": "title"}]', NULL, '2026-10-06 06:23:35.714604+00', '2026-10-06 06:23:35.714604+00');
INSERT INTO ont_legacy.entity (id, type_key, props, property_text, keyword_text, keyword_segments, embedding, created_at, updated_at) VALUES ('bcc25d0d-2ed3-452c-b391-08f06454dd58', 'article', '{"title": "Untitled draft"}', 'article: title=Untitled draft', 'Untitled draft', '[{"text": "Untitled draft", "propertyKey": "title"}]', NULL, '2026-10-06 06:23:35.753128+00', '2026-10-06 06:23:35.753128+00');
INSERT INTO ont_legacy.entity (id, type_key, props, property_text, keyword_text, keyword_segments, embedding, created_at, updated_at) VALUES ('5772b0e7-9ba7-4725-8863-ab2d072a21af', 'empty', '{}', 'empty', '', '[]', NULL, '2026-10-06 06:23:35.809782+00', '2026-10-06 06:23:35.809782+00');
INSERT INTO ont_legacy.entity (id, type_key, props, property_text, keyword_text, keyword_segments, embedding, created_at, updated_at) VALUES ('614a2e2c-7b7e-42f6-ad1e-e6abe163c947', 'empty', '{}', 'empty', '', '[]', NULL, '2026-10-06 06:23:35.823985+00', '2026-10-06 06:23:35.823985+00');
INSERT INTO ont_legacy.entity (id, type_key, props, property_text, keyword_text, keyword_segments, embedding, created_at, updated_at) VALUES ('1689c145-5be9-4bc9-9349-5d32834abde2', 'gauge', '{"count": 7, "reading": 3.5, "recorded_on": "2026-05-01"}', 'gauge', '', '[]', NULL, '2026-10-06 06:23:35.765665+00', '2026-10-06 06:23:35.765665+00');
INSERT INTO ont_legacy.entity (id, type_key, props, property_text, keyword_text, keyword_segments, embedding, created_at, updated_at) VALUES ('0037d396-64d7-43fd-889f-d938b9678110', 'gauge', '{"count": 1, "reading": 1, "recorded_on": "2026-05-02"}', 'gauge', '', '[]', NULL, '2026-10-06 06:23:35.779766+00', '2026-10-06 06:23:35.779766+00');
INSERT INTO ont_legacy.entity (id, type_key, props, property_text, keyword_text, keyword_segments, embedding, created_at, updated_at) VALUES ('e0e7fbcb-c1bf-4591-8467-1163a94b177c', 'memo', '{"body": "Remember to rebuild the search indices after the upgrade.", "code": "M-1", "_doc_body_length": 57}', 'memo: code=M-1', 'M-1', '[{"text": "M-1", "propertyKey": "code"}]', NULL, '2026-10-06 06:23:35.877245+00', '2026-10-06 06:23:35.877245+00');
INSERT INTO ont_legacy.entity (id, type_key, props, property_text, keyword_text, keyword_segments, embedding, created_at, updated_at) VALUES ('4c953c4f-24e2-4ad7-943a-469956d5304f', 'reading', '{"name": 42, "value": 0.5}', 'reading', '', '[]', NULL, '2026-10-06 06:23:35.794375+00', '2026-10-06 06:23:35.794375+00');
INSERT INTO ont_legacy.entity (id, type_key, props, property_text, keyword_text, keyword_segments, embedding, created_at, updated_at) VALUES ('f387df6a-b59a-4a1d-9e74-6f7ebedca061', 'tag', '{"code": "DB", "label": "databases"}', 'tag: code=DB, label=databases', 'DB
databases', '[{"text": "DB", "propertyKey": "code"}, {"text": "databases", "propertyKey": "label"}]', NULL, '2026-10-06 06:23:35.842258+00', '2026-10-06 06:23:35.842258+00');
INSERT INTO ont_legacy.entity (id, type_key, props, property_text, keyword_text, keyword_segments, embedding, created_at, updated_at) VALUES ('de69ab4b-443e-49cb-853b-410c328e0a7a', 'tag', '{"code": "SR", "label": "search"}', 'tag: code=SR, label=search', 'SR
search', '[{"text": "SR", "propertyKey": "code"}, {"text": "search", "propertyKey": "label"}]', NULL, '2026-10-06 06:23:35.859826+00', '2026-10-06 06:23:35.859826+00');
INSERT INTO ont_legacy.entity (id, type_key, props, property_text, keyword_text, keyword_segments, embedding, created_at, updated_at) VALUES ('afdb15b5-70dc-48f3-82cc-ac265f324f42', 'ticket', '{"zeta": "Broken login page", "alpha": "AAA", "notes": "The login page throws an error after the password reset.", "priority": 2, "_doc_notes_length": 56}', 'ticket: alpha=AAA, zeta=Broken login page', 'AAA
Broken login page', '[{"text": "AAA", "propertyKey": "alpha"}, {"text": "Broken login page", "propertyKey": "zeta"}]', NULL, '2026-10-06 06:23:37.565783+00', '2026-10-06 06:23:37.565783+00');
INSERT INTO ont_legacy.entity (id, type_key, props, property_text, keyword_text, keyword_segments, embedding, created_at, updated_at) VALUES ('fba3c9b5-127e-4566-aca8-52a68cd4fc61', 'ghost', '{"name": "Orphan"}', 'ghost: name=Orphan', 'Orphan', '[{"text": "Orphan", "propertyKey": "name"}]', NULL, '2026-10-06 06:23:50.689922+00', '2026-10-06 06:23:50.689922+00');

INSERT INTO ont_legacy.entity_type (entity_type_id, key, display_name, description, created_at, updated_at) VALUES ('717b1e2d-d0f4-4a1e-8f38-83ace40702ac', 'article', 'Article', 'A written piece', '2026-10-06 06:23:35.53128+00', '2026-10-06 06:23:35.53128+00');
INSERT INTO ont_legacy.entity_type (entity_type_id, key, display_name, description, created_at, updated_at) VALUES ('28f976ea-8812-4673-af4f-ab141d2e96f8', 'gauge', 'Gauge', 'A measuring device without any text property', '2026-10-06 06:23:35.547035+00', '2026-10-06 06:23:35.547035+00');
INSERT INTO ont_legacy.entity_type (entity_type_id, key, display_name, description, created_at, updated_at) VALUES ('b433c1a5-7ca2-48b0-9458-49ac4754511b', 'reading', 'Reading', 'Integer name, no string', '2026-10-06 06:23:35.552712+00', '2026-10-06 06:23:35.552712+00');
INSERT INTO ont_legacy.entity_type (entity_type_id, key, display_name, description, created_at, updated_at) VALUES ('1b013770-0a3f-42a6-8e69-0b30c7803721', 'empty', 'Empty', 'No properties at all', '2026-10-06 06:23:35.557019+00', '2026-10-06 06:23:35.557019+00');
INSERT INTO ont_legacy.entity_type (entity_type_id, key, display_name, description, created_at, updated_at) VALUES ('bd76d738-f3bc-439d-b699-453a6202d7d9', 'tag', 'Tag', NULL, '2026-10-06 06:23:35.559811+00', '2026-10-06 06:23:35.559811+00');
INSERT INTO ont_legacy.entity_type (entity_type_id, key, display_name, description, created_at, updated_at) VALUES ('0a597f74-f984-4678-b5b7-b7e8dbb75cc8', 'memo', 'Memo', NULL, '2026-10-06 06:23:35.564448+00', '2026-10-06 06:23:35.564448+00');
INSERT INTO ont_legacy.entity_type (entity_type_id, key, display_name, description, created_at, updated_at) VALUES ('02dce346-8958-4a21-8564-bb5301b22054', 'ticket', 'Ticket', NULL, '2026-10-06 06:23:36.508652+00', '2026-10-06 06:23:36.508652+00');

INSERT INTO ont_legacy.lens (lens_id, key, name, description, created_at, updated_at) VALUES ('fac888f4-9e71-4c92-8ebf-f9888d7dc33e', 'all', 'All', 'Unscoped', '2026-10-06 06:23:35.575457+00', '2026-10-06 06:23:35.575457+00');
INSERT INTO ont_legacy.lens (lens_id, key, name, description, created_at, updated_at) VALUES ('9c599f4d-0ad7-45b6-9a7c-441705916cad', 'brief', 'Brief', 'Articles without their body', '2026-10-06 06:23:35.618192+00', '2026-10-06 06:23:35.618192+00');
INSERT INTO ont_legacy.lens (lens_id, key, name, description, created_at, updated_at) VALUES ('72581f47-0e83-419a-a68e-bdc4dfd4adab', 'full', 'Full', 'Articles with body, memos', '2026-10-06 06:23:35.625891+00', '2026-10-06 06:23:35.625891+00');
INSERT INTO ont_legacy.lens (lens_id, key, name, description, created_at, updated_at) VALUES ('57fb3ca9-cc5f-4a40-ba72-fa98b2682bb8', 'links', 'Links', 'Relations only', '2026-10-06 06:23:35.629559+00', '2026-10-06 06:23:35.629559+00');
INSERT INTO ont_legacy.lens (lens_id, key, name, description, created_at, updated_at) VALUES ('af70ac0d-cd07-4921-be73-515f90754887', 'gauges', 'Gauges', 'Gauges without properties', '2026-10-06 06:23:35.631881+00', '2026-10-06 06:23:35.631881+00');

INSERT INTO ont_legacy.lens_includes (lens_id, entity_type_id, relation_type_id, properties) VALUES ('9c599f4d-0ad7-45b6-9a7c-441705916cad', '717b1e2d-d0f4-4a1e-8f38-83ace40702ac', NULL, '{title,summary}');
INSERT INTO ont_legacy.lens_includes (lens_id, entity_type_id, relation_type_id, properties) VALUES ('9c599f4d-0ad7-45b6-9a7c-441705916cad', 'bd76d738-f3bc-439d-b699-453a6202d7d9', NULL, NULL);
INSERT INTO ont_legacy.lens_includes (lens_id, entity_type_id, relation_type_id, properties) VALUES ('9c599f4d-0ad7-45b6-9a7c-441705916cad', NULL, '7ef81971-defa-4836-9c3f-078fff84791e', '{weight}');
INSERT INTO ont_legacy.lens_includes (lens_id, entity_type_id, relation_type_id, properties) VALUES ('72581f47-0e83-419a-a68e-bdc4dfd4adab', '717b1e2d-d0f4-4a1e-8f38-83ace40702ac', NULL, NULL);
INSERT INTO ont_legacy.lens_includes (lens_id, entity_type_id, relation_type_id, properties) VALUES ('72581f47-0e83-419a-a68e-bdc4dfd4adab', '0a597f74-f984-4678-b5b7-b7e8dbb75cc8', NULL, '{body}');
INSERT INTO ont_legacy.lens_includes (lens_id, entity_type_id, relation_type_id, properties) VALUES ('57fb3ca9-cc5f-4a40-ba72-fa98b2682bb8', NULL, '10cb4362-84de-4a70-bc83-5a6320143284', NULL);
INSERT INTO ont_legacy.lens_includes (lens_id, entity_type_id, relation_type_id, properties) VALUES ('af70ac0d-cd07-4921-be73-515f90754887', '28f976ea-8812-4673-af4f-ab141d2e96f8', NULL, '{}');

INSERT INTO ont_legacy.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('3b8a6db6-91f8-484a-969e-9bef2e2d2dc5', '717b1e2d-d0f4-4a1e-8f38-83ace40702ac', NULL, 'summary', 'Summary', NULL, 'string', false, NULL, '2026-10-06 06:23:35.532886+00', '2026-10-06 06:23:35.532886+00');
INSERT INTO ont_legacy.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('347ef8b4-4a5e-45cd-9dad-d66d2b53d700', '717b1e2d-d0f4-4a1e-8f38-83ace40702ac', NULL, 'label', 'Label', NULL, 'string', false, NULL, '2026-10-06 06:23:35.536056+00', '2026-10-06 06:23:35.536056+00');
INSERT INTO ont_legacy.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('0c9cbcc6-c021-428d-b655-7e81cabe3f3a', '717b1e2d-d0f4-4a1e-8f38-83ace40702ac', NULL, 'title', 'Title', NULL, 'string', true, NULL, '2026-10-06 06:23:35.537215+00', '2026-10-06 06:23:35.537215+00');
INSERT INTO ont_legacy.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('22c40e07-69d9-4c17-8dbd-9e0ed8959d5e', '717b1e2d-d0f4-4a1e-8f38-83ace40702ac', NULL, 'body', 'Body', NULL, 'document', false, NULL, '2026-10-06 06:23:35.538273+00', '2026-10-06 06:23:35.538273+00');
INSERT INTO ont_legacy.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('35676acb-fc4a-4d66-8f54-5d47caa5fe0b', '717b1e2d-d0f4-4a1e-8f38-83ace40702ac', NULL, 'published_on', 'Published On', NULL, 'date', false, NULL, '2026-10-06 06:23:35.539277+00', '2026-10-06 06:23:35.539277+00');
INSERT INTO ont_legacy.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('b877f9e1-9d2c-407c-9a0a-03c9454af04f', '717b1e2d-d0f4-4a1e-8f38-83ace40702ac', NULL, 'word_count', 'Word Count', NULL, 'integer', false, NULL, '2026-10-06 06:23:35.541536+00', '2026-10-06 06:23:35.541536+00');
INSERT INTO ont_legacy.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('f6d32e56-ddb6-4842-be4b-980e0906457e', '28f976ea-8812-4673-af4f-ab141d2e96f8', NULL, 'reading', 'Reading', NULL, 'float', false, NULL, '2026-10-06 06:23:35.548004+00', '2026-10-06 06:23:35.548004+00');
INSERT INTO ont_legacy.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('9b4e2c22-9246-4fbf-bcb3-6abef41386af', '28f976ea-8812-4673-af4f-ab141d2e96f8', NULL, 'recorded_on', 'Recorded On', NULL, 'date', false, NULL, '2026-10-06 06:23:35.549008+00', '2026-10-06 06:23:35.549008+00');
INSERT INTO ont_legacy.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('f561dc87-caf1-4352-a2d3-28325e922bd4', '28f976ea-8812-4673-af4f-ab141d2e96f8', NULL, 'count', 'Count', NULL, 'integer', false, NULL, '2026-10-06 06:23:35.550066+00', '2026-10-06 06:23:35.550066+00');
INSERT INTO ont_legacy.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('4cf13d07-17a3-4f83-884b-a5375ecf6212', 'b433c1a5-7ca2-48b0-9458-49ac4754511b', NULL, 'name', 'Name', NULL, 'integer', false, NULL, '2026-10-06 06:23:35.553619+00', '2026-10-06 06:23:35.553619+00');
INSERT INTO ont_legacy.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('c0f4f9e5-7412-4b28-b740-31a79fc0a8bc', 'b433c1a5-7ca2-48b0-9458-49ac4754511b', NULL, 'value', 'Value', NULL, 'float', false, NULL, '2026-10-06 06:23:35.554584+00', '2026-10-06 06:23:35.554584+00');
INSERT INTO ont_legacy.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('b765483b-6cde-4c00-8ee5-43b7924fed8d', 'bd76d738-f3bc-439d-b699-453a6202d7d9', NULL, 'label', 'Label', NULL, 'string', true, NULL, '2026-10-06 06:23:35.56079+00', '2026-10-06 06:23:35.56079+00');
INSERT INTO ont_legacy.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('10e995da-9dd6-4835-86f3-4e7ede201f4e', 'bd76d738-f3bc-439d-b699-453a6202d7d9', NULL, 'code', 'Code', NULL, 'string', false, NULL, '2026-10-06 06:23:35.561866+00', '2026-10-06 06:23:35.561866+00');
INSERT INTO ont_legacy.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('6a7d511a-7cac-4c90-a63d-7cafb7907a83', '0a597f74-f984-4678-b5b7-b7e8dbb75cc8', NULL, 'body', 'Body', NULL, 'document', false, NULL, '2026-10-06 06:23:35.565327+00', '2026-10-06 06:23:35.565327+00');
INSERT INTO ont_legacy.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('5c7b50ef-c7f1-48b4-b21b-3179a0de5e7f', '0a597f74-f984-4678-b5b7-b7e8dbb75cc8', NULL, 'code', 'Code', NULL, 'string', false, NULL, '2026-10-06 06:23:35.566237+00', '2026-10-06 06:23:35.566237+00');
INSERT INTO ont_legacy.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('17f283b6-646e-49b5-a722-59295386febc', NULL, '7ef81971-defa-4836-9c3f-078fff84791e', 'weight', 'Weight', NULL, 'float', false, NULL, '2026-10-06 06:23:35.572545+00', '2026-10-06 06:23:35.572545+00');
INSERT INTO ont_legacy.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('52b52081-9fbf-4736-8f2a-099d355150ce', NULL, '7ef81971-defa-4836-9c3f-078fff84791e', 'since', 'Since', NULL, 'date', false, NULL, '2026-10-06 06:23:35.573491+00', '2026-10-06 06:23:35.573491+00');
INSERT INTO ont_legacy.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('279cd9b3-5994-498a-887a-e7e480d783d9', '02dce346-8958-4a21-8564-bb5301b22054', NULL, 'zeta', 'Zeta', NULL, 'string', false, NULL, '2026-10-06 06:23:36.748877+00', '2026-10-06 06:23:36.748877+00');
INSERT INTO ont_legacy.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('dcd3c700-d775-4ab2-a82b-a98ae7389d41', '02dce346-8958-4a21-8564-bb5301b22054', NULL, 'priority', 'Priority', NULL, 'integer', false, NULL, '2026-10-06 06:23:36.990961+00', '2026-10-06 06:23:36.990961+00');
INSERT INTO ont_legacy.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('48c3b629-aea9-440d-899d-e6af36c09877', '02dce346-8958-4a21-8564-bb5301b22054', NULL, 'alpha', 'Alpha', NULL, 'string', false, NULL, '2026-10-06 06:23:37.247216+00', '2026-10-06 06:23:37.247216+00');
INSERT INTO ont_legacy.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('87278bc9-ac26-4fcd-87eb-a01fc814d211', '02dce346-8958-4a21-8564-bb5301b22054', NULL, 'notes', 'Notes', NULL, 'document', false, NULL, '2026-10-06 06:23:37.500416+00', '2026-10-06 06:23:37.500416+00');

INSERT INTO ont_legacy.relation (id, type_key, from_id, to_id, props, created_at, updated_at) VALUES ('c9522416-b6b3-43c7-9d20-a4a9c6dbf778', 'tagged', 'cc8ed390-8178-41c0-93ca-1690d74339da', 'f387df6a-b59a-4a1d-9e74-6f7ebedca061', '{"since": "2026-01-16", "weight": 0.9}', '2026-10-06 06:23:35.907952+00', '2026-10-06 06:23:35.907952+00');
INSERT INTO ont_legacy.relation (id, type_key, from_id, to_id, props, created_at, updated_at) VALUES ('5b1e8dd0-8537-4287-a7b1-43f7e53d8132', 'tagged', 'f1c64570-2384-4daa-a37a-289d06ba0d1a', 'de69ab4b-443e-49cb-853b-410c328e0a7a', '{"weight": 0.7}', '2026-10-06 06:23:35.914006+00', '2026-10-06 06:23:35.914006+00');
INSERT INTO ont_legacy.relation (id, type_key, from_id, to_id, props, created_at, updated_at) VALUES ('1706c190-d7e3-4e2a-8128-832709041488', 'tagged', 'cc8ed390-8178-41c0-93ca-1690d74339da', 'de69ab4b-443e-49cb-853b-410c328e0a7a', '{}', '2026-10-06 06:23:35.920866+00', '2026-10-06 06:23:35.920866+00');
INSERT INTO ont_legacy.relation (id, type_key, from_id, to_id, props, created_at, updated_at) VALUES ('2ade5b8c-7bf9-46b9-b2a2-b13240990298', 'measures', '1689c145-5be9-4bc9-9349-5d32834abde2', 'cc8ed390-8178-41c0-93ca-1690d74339da', '{}', '2026-10-06 06:23:35.926754+00', '2026-10-06 06:23:35.926754+00');

INSERT INTO ont_legacy.relation_type (relation_type_id, key, display_name, description, source_entity_type_key, target_entity_type_key, created_at, updated_at) VALUES ('7ef81971-defa-4836-9c3f-078fff84791e', 'tagged', 'Tagged', NULL, 'article', 'tag', '2026-10-06 06:23:35.571473+00', '2026-10-06 06:23:35.571473+00');
INSERT INTO ont_legacy.relation_type (relation_type_id, key, display_name, description, source_entity_type_key, target_entity_type_key, created_at, updated_at) VALUES ('10cb4362-84de-4a70-bc83-5a6320143284', 'measures', 'Measures', NULL, 'gauge', 'article', '2026-10-06 06:23:35.574402+00', '2026-10-06 06:23:35.574402+00');

INSERT INTO ont_legacy.saved_query (saved_query_id, lens_id, lens_key, key, name, description, steps, parameters, embedding, created_at, updated_at) VALUES ('f04b1083-8bf3-4fdb-89b7-8483c8f1ce10', 'fac888f4-9e71-4c92-8ebf-f9888d7dc33e', 'all', 'articles-by-tag', 'Articles by tag', 'Lists articles with their tags', '[{"name":"main","type":"oql","oql":"MATCH (a:article)-[:tagged]->(t:tag) RETURN a.title AS title, t.label AS tag ORDER BY title"}]', '[]', NULL, '2026-10-06 06:23:35.615434+00', '2026-10-06 06:23:35.615434+00');

ALTER TABLE ONLY ont_legacy_de.ai_agent_config
    ADD CONSTRAINT ai_agent_config_key_unique UNIQUE (lens_id, key);

ALTER TABLE ONLY ont_legacy_de.ai_agent_config
    ADD CONSTRAINT ai_agent_config_pk PRIMARY KEY (agent_config_id);

ALTER TABLE ONLY ont_legacy_de.document_chunk
    ADD CONSTRAINT document_chunk_pk PRIMARY KEY (id);

ALTER TABLE ONLY ont_legacy_de.entity
    ADD CONSTRAINT entity_pk PRIMARY KEY (id);

ALTER TABLE ONLY ont_legacy_de.entity_type
    ADD CONSTRAINT entity_type_key_unique UNIQUE (key);

ALTER TABLE ONLY ont_legacy_de.entity_type
    ADD CONSTRAINT entity_type_pk PRIMARY KEY (entity_type_id);

ALTER TABLE ONLY ont_legacy_de.lens_includes
    ADD CONSTRAINT lens_includes_entity_unique UNIQUE (lens_id, entity_type_id);

ALTER TABLE ONLY ont_legacy_de.lens_includes
    ADD CONSTRAINT lens_includes_relation_unique UNIQUE (lens_id, relation_type_id);

ALTER TABLE ONLY ont_legacy_de.lens
    ADD CONSTRAINT lens_key_unique UNIQUE (key);

ALTER TABLE ONLY ont_legacy_de.lens
    ADD CONSTRAINT lens_name_unique UNIQUE (name);

ALTER TABLE ONLY ont_legacy_de.lens
    ADD CONSTRAINT lens_pk PRIMARY KEY (lens_id);

ALTER TABLE ONLY ont_legacy_de.property_def
    ADD CONSTRAINT property_def_entity_key_unique UNIQUE (entity_type_id, key);

ALTER TABLE ONLY ont_legacy_de.property_def
    ADD CONSTRAINT property_def_pk PRIMARY KEY (property_id);

ALTER TABLE ONLY ont_legacy_de.property_def
    ADD CONSTRAINT property_def_relation_key_unique UNIQUE (relation_type_id, key);

ALTER TABLE ONLY ont_legacy_de.relation
    ADD CONSTRAINT relation_pk PRIMARY KEY (id);

ALTER TABLE ONLY ont_legacy_de.relation_type
    ADD CONSTRAINT relation_type_key_unique UNIQUE (key);

ALTER TABLE ONLY ont_legacy_de.relation_type
    ADD CONSTRAINT relation_type_pk PRIMARY KEY (relation_type_id);

ALTER TABLE ONLY ont_legacy_de.saved_query
    ADD CONSTRAINT saved_query_key_unique UNIQUE (lens_id, key);

ALTER TABLE ONLY ont_legacy_de.saved_query
    ADD CONSTRAINT saved_query_pk PRIMARY KEY (saved_query_id);

ALTER TABLE ONLY ont_legacy.ai_agent_config
    ADD CONSTRAINT ai_agent_config_key_unique UNIQUE (lens_id, key);

ALTER TABLE ONLY ont_legacy.ai_agent_config
    ADD CONSTRAINT ai_agent_config_pk PRIMARY KEY (agent_config_id);

ALTER TABLE ONLY ont_legacy.document_chunk
    ADD CONSTRAINT document_chunk_pk PRIMARY KEY (id);

ALTER TABLE ONLY ont_legacy.entity
    ADD CONSTRAINT entity_pk PRIMARY KEY (id);

ALTER TABLE ONLY ont_legacy.entity_type
    ADD CONSTRAINT entity_type_key_unique UNIQUE (key);

ALTER TABLE ONLY ont_legacy.entity_type
    ADD CONSTRAINT entity_type_pk PRIMARY KEY (entity_type_id);

ALTER TABLE ONLY ont_legacy.lens_includes
    ADD CONSTRAINT lens_includes_entity_unique UNIQUE (lens_id, entity_type_id);

ALTER TABLE ONLY ont_legacy.lens_includes
    ADD CONSTRAINT lens_includes_relation_unique UNIQUE (lens_id, relation_type_id);

ALTER TABLE ONLY ont_legacy.lens
    ADD CONSTRAINT lens_key_unique UNIQUE (key);

ALTER TABLE ONLY ont_legacy.lens
    ADD CONSTRAINT lens_name_unique UNIQUE (name);

ALTER TABLE ONLY ont_legacy.lens
    ADD CONSTRAINT lens_pk PRIMARY KEY (lens_id);

ALTER TABLE ONLY ont_legacy.property_def
    ADD CONSTRAINT property_def_entity_key_unique UNIQUE (entity_type_id, key);

ALTER TABLE ONLY ont_legacy.property_def
    ADD CONSTRAINT property_def_pk PRIMARY KEY (property_id);

ALTER TABLE ONLY ont_legacy.property_def
    ADD CONSTRAINT property_def_relation_key_unique UNIQUE (relation_type_id, key);

ALTER TABLE ONLY ont_legacy.relation
    ADD CONSTRAINT relation_pk PRIMARY KEY (id);

ALTER TABLE ONLY ont_legacy.relation_type
    ADD CONSTRAINT relation_type_key_unique UNIQUE (key);

ALTER TABLE ONLY ont_legacy.relation_type
    ADD CONSTRAINT relation_type_pk PRIMARY KEY (relation_type_id);

ALTER TABLE ONLY ont_legacy.saved_query
    ADD CONSTRAINT saved_query_key_unique UNIQUE (lens_id, key);

ALTER TABLE ONLY ont_legacy.saved_query
    ADD CONSTRAINT saved_query_pk PRIMARY KEY (saved_query_id);

CREATE INDEX document_chunk_entity_property_idx ON ont_legacy_de.document_chunk USING btree (entity_id, property_key);

CREATE INDEX document_keyword_idx ON ont_legacy_de.document_chunk USING gin (search_vector);

CREATE INDEX entity_keyword_idx ON ont_legacy_de.entity USING gin (search_vector);

CREATE INDEX entity_type_key_idx ON ont_legacy_de.entity USING btree (type_key);

CREATE INDEX relation_from_id_idx ON ont_legacy_de.relation USING btree (from_id);

CREATE INDEX relation_to_id_idx ON ont_legacy_de.relation USING btree (to_id);

CREATE INDEX relation_type_key_idx ON ont_legacy_de.relation USING btree (type_key);

CREATE INDEX saved_query_embedding_idx ON ont_legacy_de.saved_query USING hnsw (((embedding)::public.vector(1024)) public.vector_cosine_ops);

CREATE INDEX vec_document_chunk_dcd08d9357324d98a4456716117a8ba4 ON ont_legacy_de.document_chunk USING hnsw (((embedding)::public.vector(1024)) public.vector_cosine_ops) WHERE ((entity_type_key = 'dokument'::text) AND (property_key = 'inhalt'::text));

CREATE INDEX vec_entity_99ec23ac200b49da9e0b0e25808ab0f3 ON ont_legacy_de.entity USING hnsw (((embedding)::public.vector(1024)) public.vector_cosine_ops) WHERE (type_key = 'dokument'::text);

CREATE INDEX vec_entity_c1b6748cc83442b5a79c928c8c1f21ae ON ont_legacy_de.entity USING hnsw (((embedding)::public.vector(1024)) public.vector_cosine_ops) WHERE (type_key = 'ort'::text);

CREATE INDEX document_chunk_entity_property_idx ON ont_legacy.document_chunk USING btree (entity_id, property_key);

CREATE INDEX document_keyword_idx ON ont_legacy.document_chunk USING gin (search_vector);

CREATE INDEX entity_keyword_idx ON ont_legacy.entity USING gin (search_vector);

CREATE INDEX entity_type_key_idx ON ont_legacy.entity USING btree (type_key);

CREATE INDEX relation_from_id_idx ON ont_legacy.relation USING btree (from_id);

CREATE INDEX relation_to_id_idx ON ont_legacy.relation USING btree (to_id);

CREATE INDEX relation_type_key_idx ON ont_legacy.relation USING btree (type_key);

CREATE INDEX saved_query_embedding_idx ON ont_legacy.saved_query USING hnsw (((embedding)::public.vector(1024)) public.vector_cosine_ops);

CREATE INDEX vec_document_chunk_22c40e0769d94c178dbd9e0ed8959d5e ON ont_legacy.document_chunk USING hnsw (((embedding)::public.vector(1024)) public.vector_cosine_ops) WHERE ((entity_type_key = 'article'::text) AND (property_key = 'body'::text));

CREATE INDEX vec_document_chunk_6a7d511a7cac4c90a63d7cafb7907a83 ON ont_legacy.document_chunk USING hnsw (((embedding)::public.vector(1024)) public.vector_cosine_ops) WHERE ((entity_type_key = 'memo'::text) AND (property_key = 'body'::text));

CREATE INDEX vec_document_chunk_87278bc9ac264fcd87eba01fc814d211 ON ont_legacy.document_chunk USING hnsw (((embedding)::public.vector(1024)) public.vector_cosine_ops) WHERE ((entity_type_key = 'ticket'::text) AND (property_key = 'notes'::text));

CREATE INDEX vec_entity_02dce34689584a218564bb5301b22054 ON ont_legacy.entity USING hnsw (((embedding)::public.vector(1024)) public.vector_cosine_ops) WHERE (type_key = 'ticket'::text);

CREATE INDEX vec_entity_0a597f74f9844678b5b7b7e8dbb75cc8 ON ont_legacy.entity USING hnsw (((embedding)::public.vector(1024)) public.vector_cosine_ops) WHERE (type_key = 'memo'::text);

CREATE INDEX vec_entity_1b0137700a3f42a68e690b30c7803721 ON ont_legacy.entity USING hnsw (((embedding)::public.vector(1024)) public.vector_cosine_ops) WHERE (type_key = 'empty'::text);

CREATE INDEX vec_entity_28f976ea88124673af4fab141d2e96f8 ON ont_legacy.entity USING hnsw (((embedding)::public.vector(1024)) public.vector_cosine_ops) WHERE (type_key = 'gauge'::text);

CREATE INDEX vec_entity_717b1e2dd0f44a1e8f3883ace40702ac ON ont_legacy.entity USING hnsw (((embedding)::public.vector(1024)) public.vector_cosine_ops) WHERE (type_key = 'article'::text);

CREATE INDEX vec_entity_a51e7b9a85564615bbf5ed13a5697d63 ON ont_legacy.entity USING hnsw (((embedding)::public.vector(1024)) public.vector_cosine_ops) WHERE (type_key = 'ghost'::text);

CREATE INDEX vec_entity_b433c1a57ca248b0945849ac4754511b ON ont_legacy.entity USING hnsw (((embedding)::public.vector(1024)) public.vector_cosine_ops) WHERE (type_key = 'reading'::text);

CREATE INDEX vec_entity_bd76d738f3bc439db699453a6202d7d9 ON ont_legacy.entity USING hnsw (((embedding)::public.vector(1024)) public.vector_cosine_ops) WHERE (type_key = 'tag'::text);

ALTER TABLE ONLY ont_legacy_de.ai_agent_config
    ADD CONSTRAINT ai_agent_config_lens_fk FOREIGN KEY (lens_id) REFERENCES ont_legacy_de.lens(lens_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_legacy_de.document_chunk
    ADD CONSTRAINT document_chunk_entity_fk FOREIGN KEY (entity_id) REFERENCES ont_legacy_de.entity(id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_legacy_de.lens_includes
    ADD CONSTRAINT lens_includes_entity_type_fk FOREIGN KEY (entity_type_id) REFERENCES ont_legacy_de.entity_type(entity_type_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_legacy_de.lens_includes
    ADD CONSTRAINT lens_includes_lens_fk FOREIGN KEY (lens_id) REFERENCES ont_legacy_de.lens(lens_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_legacy_de.lens_includes
    ADD CONSTRAINT lens_includes_relation_type_fk FOREIGN KEY (relation_type_id) REFERENCES ont_legacy_de.relation_type(relation_type_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_legacy_de.property_def
    ADD CONSTRAINT property_def_entity_type_fk FOREIGN KEY (entity_type_id) REFERENCES ont_legacy_de.entity_type(entity_type_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_legacy_de.property_def
    ADD CONSTRAINT property_def_relation_type_fk FOREIGN KEY (relation_type_id) REFERENCES ont_legacy_de.relation_type(relation_type_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_legacy_de.relation
    ADD CONSTRAINT relation_from_fk FOREIGN KEY (from_id) REFERENCES ont_legacy_de.entity(id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_legacy_de.relation
    ADD CONSTRAINT relation_to_fk FOREIGN KEY (to_id) REFERENCES ont_legacy_de.entity(id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_legacy_de.relation_type
    ADD CONSTRAINT relation_type_source_fk FOREIGN KEY (source_entity_type_key) REFERENCES ont_legacy_de.entity_type(key) ON DELETE RESTRICT;

ALTER TABLE ONLY ont_legacy_de.relation_type
    ADD CONSTRAINT relation_type_target_fk FOREIGN KEY (target_entity_type_key) REFERENCES ont_legacy_de.entity_type(key) ON DELETE RESTRICT;

ALTER TABLE ONLY ont_legacy_de.saved_query
    ADD CONSTRAINT saved_query_lens_fk FOREIGN KEY (lens_id) REFERENCES ont_legacy_de.lens(lens_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_legacy.ai_agent_config
    ADD CONSTRAINT ai_agent_config_lens_fk FOREIGN KEY (lens_id) REFERENCES ont_legacy.lens(lens_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_legacy.document_chunk
    ADD CONSTRAINT document_chunk_entity_fk FOREIGN KEY (entity_id) REFERENCES ont_legacy.entity(id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_legacy.lens_includes
    ADD CONSTRAINT lens_includes_entity_type_fk FOREIGN KEY (entity_type_id) REFERENCES ont_legacy.entity_type(entity_type_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_legacy.lens_includes
    ADD CONSTRAINT lens_includes_lens_fk FOREIGN KEY (lens_id) REFERENCES ont_legacy.lens(lens_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_legacy.lens_includes
    ADD CONSTRAINT lens_includes_relation_type_fk FOREIGN KEY (relation_type_id) REFERENCES ont_legacy.relation_type(relation_type_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_legacy.property_def
    ADD CONSTRAINT property_def_entity_type_fk FOREIGN KEY (entity_type_id) REFERENCES ont_legacy.entity_type(entity_type_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_legacy.property_def
    ADD CONSTRAINT property_def_relation_type_fk FOREIGN KEY (relation_type_id) REFERENCES ont_legacy.relation_type(relation_type_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_legacy.relation
    ADD CONSTRAINT relation_from_fk FOREIGN KEY (from_id) REFERENCES ont_legacy.entity(id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_legacy.relation
    ADD CONSTRAINT relation_to_fk FOREIGN KEY (to_id) REFERENCES ont_legacy.entity(id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_legacy.relation_type
    ADD CONSTRAINT relation_type_source_fk FOREIGN KEY (source_entity_type_key) REFERENCES ont_legacy.entity_type(key) ON DELETE RESTRICT;

ALTER TABLE ONLY ont_legacy.relation_type
    ADD CONSTRAINT relation_type_target_fk FOREIGN KEY (target_entity_type_key) REFERENCES ont_legacy.entity_type(key) ON DELETE RESTRICT;

ALTER TABLE ONLY ont_legacy.saved_query
    ADD CONSTRAINT saved_query_lens_fk FOREIGN KEY (lens_id) REFERENCES ont_legacy.lens(lens_id) ON DELETE CASCADE;
