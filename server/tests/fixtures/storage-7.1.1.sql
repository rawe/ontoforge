-- Storage of OntoForge 7.1.1 — the last release of the 7.x line, storage
-- version 8. Produced by the v7.1.1 server (git tag v7.1.1) on PostgreSQL 18
-- with pgvector 0.8.6 and no embedding or AI provider, so its search indices
-- built keyword entries only and no vector is stored. Two ontologies created
-- and filled through its API: `upgrade` (keyword language english) and
-- `upgrade_de` (german), each a 7.0 design import — entity and relation types
-- with properties, parent relations, an unscoped and a scoped lens, a custom
-- search index, agents, a retriever, a navigator, saved queries (one with a
-- search step) — then data writes with document properties and a document
-- edit, two rulesets, and changesets (a draft, a submitted one through a
-- ruleset, a committed one); then, once every index had built,
--   pg_dump --no-owner --no-privileges --column-inserts \
--     -t public.ontology -t public.storage_version
--   pg_dump --no-owner --no-privileges --column-inserts -n <both namespaces>
-- The only edits: session SET lines, psql meta-commands and pg_dump comments
-- removed. Never regenerate it with a newer release: it is the frozen layout
-- the 8.x storage upgrade starts from
-- (tests/integration/postgres/storage-version.test.ts).


CREATE TABLE public.ontology (
    ontology_id uuid NOT NULL,
    key text NOT NULL,
    display_name text,
    namespace text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.storage_version (
    version integer NOT NULL
);

INSERT INTO public.ontology (ontology_id, key, display_name, namespace, created_at, updated_at) VALUES ('9b81d09d-f332-4e60-bb21-35fcb322d510', 'upgrade', NULL, 'ont_upgrade', '2026-11-15 22:34:29.413885+00', '2026-11-15 22:34:29.413885+00');
INSERT INTO public.ontology (ontology_id, key, display_name, namespace, created_at, updated_at) VALUES ('73b61abd-ac45-404f-a46c-79f91e46fdea', 'upgrade_de', NULL, 'ont_upgrade_de', '2026-11-15 22:34:29.621167+00', '2026-11-15 22:34:29.621167+00');

INSERT INTO public.storage_version (version) VALUES (8);

ALTER TABLE ONLY public.ontology
    ADD CONSTRAINT ontology_display_name_unique UNIQUE (display_name);

ALTER TABLE ONLY public.ontology
    ADD CONSTRAINT ontology_key_unique UNIQUE (key);

ALTER TABLE ONLY public.ontology
    ADD CONSTRAINT ontology_pk PRIMARY KEY (ontology_id);

CREATE SCHEMA ont_upgrade;

CREATE SCHEMA ont_upgrade_de;

CREATE TABLE ont_upgrade.assistant_agent (
    assistant_agent_id uuid NOT NULL,
    lens_id uuid NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    description text,
    system_prompt text,
    tools text[],
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ont_upgrade.assistant_navigator (
    assistant_navigator_id uuid NOT NULL,
    lens_id uuid NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    description text,
    config_version integer NOT NULL,
    config jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ont_upgrade.assistant_retriever (
    assistant_retriever_id uuid NOT NULL,
    lens_id uuid NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    description text,
    config_version integer NOT NULL,
    config jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    warnings jsonb DEFAULT '[]'::jsonb NOT NULL
);

CREATE TABLE ont_upgrade.changeset (
    changeset_id uuid NOT NULL,
    lens_id uuid NOT NULL,
    number integer NOT NULL,
    ruleset_key text,
    version integer NOT NULL,
    note text,
    submitted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_change_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ont_upgrade.changeset_object (
    changeset_id uuid NOT NULL,
    object_id uuid NOT NULL,
    kind text NOT NULL,
    type_key text NOT NULL,
    action text NOT NULL,
    from_id uuid,
    to_id uuid,
    first_touched_at timestamp with time zone NOT NULL
);

CREATE TABLE ont_upgrade.changeset_value (
    changeset_id uuid NOT NULL,
    object_id uuid NOT NULL,
    property_key text NOT NULL,
    value jsonb NOT NULL,
    before jsonb,
    bytes integer NOT NULL
);

CREATE TABLE ont_upgrade.entity (
    id uuid NOT NULL,
    type_key text CONSTRAINT entity_type_key_not_null1 NOT NULL,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ont_upgrade.entity_type (
    entity_type_id uuid NOT NULL,
    key text NOT NULL,
    display_name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    name_property text NOT NULL
);

CREATE TABLE ont_upgrade.lens (
    lens_id uuid NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ont_upgrade.lens_includes (
    lens_id uuid NOT NULL,
    entity_type_id uuid,
    relation_type_id uuid,
    properties text[],
    search_index_id uuid,
    CONSTRAINT lens_includes_one_type CHECK ((num_nonnulls(entity_type_id, relation_type_id, search_index_id) = 1))
);

CREATE TABLE ont_upgrade.property_def (
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

CREATE TABLE ont_upgrade.relation (
    id uuid NOT NULL,
    type_key text CONSTRAINT relation_type_key_not_null1 NOT NULL,
    from_id uuid NOT NULL,
    to_id uuid NOT NULL,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ont_upgrade.relation_type (
    relation_type_id uuid NOT NULL,
    key text NOT NULL,
    display_name text NOT NULL,
    description text,
    source_entity_type_key text NOT NULL,
    target_entity_type_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    parent text
);

CREATE TABLE ont_upgrade.ruleset (
    key text NOT NULL,
    anchor_type_key text,
    anchor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    write_access text DEFAULT 'full'::text NOT NULL
);

CREATE TABLE ont_upgrade.saved_query (
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

CREATE TABLE ont_upgrade.search_entry (
    generation_id uuid NOT NULL,
    entity_id uuid NOT NULL,
    part_kind text NOT NULL,
    group_no integer NOT NULL,
    part_id text NOT NULL,
    relation_type text,
    target_type text,
    target_id uuid,
    start_char integer,
    char_length integer,
    text text NOT NULL,
    text_hash bytea NOT NULL,
    embedding public.halfvec,
    tsv tsvector
)
PARTITION BY LIST (generation_id);

CREATE TABLE ont_upgrade.se_1b92cadc186a42b09bd6594ef250c956 (
    generation_id uuid CONSTRAINT search_entry_generation_id_not_null NOT NULL,
    entity_id uuid CONSTRAINT search_entry_entity_id_not_null NOT NULL,
    part_kind text CONSTRAINT search_entry_part_kind_not_null NOT NULL,
    group_no integer CONSTRAINT search_entry_group_no_not_null NOT NULL,
    part_id text CONSTRAINT search_entry_part_id_not_null NOT NULL,
    relation_type text,
    target_type text,
    target_id uuid,
    start_char integer,
    char_length integer,
    text text CONSTRAINT search_entry_text_not_null NOT NULL,
    text_hash bytea CONSTRAINT search_entry_text_hash_not_null NOT NULL,
    embedding public.halfvec,
    tsv tsvector
);

CREATE TABLE ont_upgrade.se_72c78607f8674206ae7dfe4d5027af5d (
    generation_id uuid CONSTRAINT search_entry_generation_id_not_null NOT NULL,
    entity_id uuid CONSTRAINT search_entry_entity_id_not_null NOT NULL,
    part_kind text CONSTRAINT search_entry_part_kind_not_null NOT NULL,
    group_no integer CONSTRAINT search_entry_group_no_not_null NOT NULL,
    part_id text CONSTRAINT search_entry_part_id_not_null NOT NULL,
    relation_type text,
    target_type text,
    target_id uuid,
    start_char integer,
    char_length integer,
    text text CONSTRAINT search_entry_text_not_null NOT NULL,
    text_hash bytea CONSTRAINT search_entry_text_hash_not_null NOT NULL,
    embedding public.halfvec,
    tsv tsvector
);

CREATE TABLE ont_upgrade.se_ae7ab2135ea04eecaa703032931d1b8a (
    generation_id uuid CONSTRAINT search_entry_generation_id_not_null NOT NULL,
    entity_id uuid CONSTRAINT search_entry_entity_id_not_null NOT NULL,
    part_kind text CONSTRAINT search_entry_part_kind_not_null NOT NULL,
    group_no integer CONSTRAINT search_entry_group_no_not_null NOT NULL,
    part_id text CONSTRAINT search_entry_part_id_not_null NOT NULL,
    relation_type text,
    target_type text,
    target_id uuid,
    start_char integer,
    char_length integer,
    text text CONSTRAINT search_entry_text_not_null NOT NULL,
    text_hash bytea CONSTRAINT search_entry_text_hash_not_null NOT NULL,
    embedding public.halfvec,
    tsv tsvector
);

CREATE TABLE ont_upgrade.se_b7c84078512b44ddb5b47305e609ab3e (
    generation_id uuid CONSTRAINT search_entry_generation_id_not_null NOT NULL,
    entity_id uuid CONSTRAINT search_entry_entity_id_not_null NOT NULL,
    part_kind text CONSTRAINT search_entry_part_kind_not_null NOT NULL,
    group_no integer CONSTRAINT search_entry_group_no_not_null NOT NULL,
    part_id text CONSTRAINT search_entry_part_id_not_null NOT NULL,
    relation_type text,
    target_type text,
    target_id uuid,
    start_char integer,
    char_length integer,
    text text CONSTRAINT search_entry_text_not_null NOT NULL,
    text_hash bytea CONSTRAINT search_entry_text_hash_not_null NOT NULL,
    embedding public.halfvec,
    tsv tsvector
);

CREATE TABLE ont_upgrade.se_bea3032f44ae4261b0219b0dea62f993 (
    generation_id uuid CONSTRAINT search_entry_generation_id_not_null NOT NULL,
    entity_id uuid CONSTRAINT search_entry_entity_id_not_null NOT NULL,
    part_kind text CONSTRAINT search_entry_part_kind_not_null NOT NULL,
    group_no integer CONSTRAINT search_entry_group_no_not_null NOT NULL,
    part_id text CONSTRAINT search_entry_part_id_not_null NOT NULL,
    relation_type text,
    target_type text,
    target_id uuid,
    start_char integer,
    char_length integer,
    text text CONSTRAINT search_entry_text_not_null NOT NULL,
    text_hash bytea CONSTRAINT search_entry_text_hash_not_null NOT NULL,
    embedding public.halfvec,
    tsv tsvector
);

CREATE TABLE ont_upgrade.se_cb975937c31b40b3a06223fd6ddae84d (
    generation_id uuid CONSTRAINT search_entry_generation_id_not_null NOT NULL,
    entity_id uuid CONSTRAINT search_entry_entity_id_not_null NOT NULL,
    part_kind text CONSTRAINT search_entry_part_kind_not_null NOT NULL,
    group_no integer CONSTRAINT search_entry_group_no_not_null NOT NULL,
    part_id text CONSTRAINT search_entry_part_id_not_null NOT NULL,
    relation_type text,
    target_type text,
    target_id uuid,
    start_char integer,
    char_length integer,
    text text CONSTRAINT search_entry_text_not_null NOT NULL,
    text_hash bytea CONSTRAINT search_entry_text_hash_not_null NOT NULL,
    embedding public.halfvec,
    tsv tsvector
);

CREATE TABLE ont_upgrade.search_generation (
    generation_id uuid NOT NULL,
    search_index_id uuid NOT NULL,
    representation text NOT NULL,
    definition_hash text NOT NULL,
    model_id text,
    dimensions integer,
    languages text[],
    state text NOT NULL,
    total integer DEFAULT 0 NOT NULL,
    done integer DEFAULT 0 NOT NULL,
    failed integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    ready_at timestamp with time zone,
    CONSTRAINT search_generation_representation_check CHECK ((representation = ANY (ARRAY['semantic'::text, 'keyword'::text]))),
    CONSTRAINT search_generation_state_check CHECK ((state = ANY (ARRAY['building'::text, 'ready'::text, 'retired'::text, 'failed'::text])))
);

CREATE TABLE ont_upgrade.search_index (
    search_index_id uuid NOT NULL,
    key text NOT NULL,
    kind text NOT NULL,
    entity_type_id uuid NOT NULL,
    definition jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT search_index_kind_check CHECK ((kind = ANY (ARRAY['default'::text, 'passage'::text, 'custom'::text])))
);

CREATE TABLE ont_upgrade.search_queue (
    generation_id uuid NOT NULL,
    entity_id uuid NOT NULL,
    part_kind text NOT NULL,
    group_no integer NOT NULL,
    part_id text NOT NULL,
    enqueued_at timestamp with time zone DEFAULT now() NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    not_before timestamp with time zone DEFAULT now() NOT NULL,
    lease_until timestamp with time zone,
    last_error text,
    last_error_at timestamp with time zone
);

CREATE TABLE ont_upgrade.search_settings (
    singleton boolean DEFAULT true NOT NULL,
    keyword_languages text[] NOT NULL,
    disabled_defaults jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT search_settings_singleton CHECK (singleton)
);

CREATE TABLE ont_upgrade_de.assistant_agent (
    assistant_agent_id uuid NOT NULL,
    lens_id uuid NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    description text,
    system_prompt text,
    tools text[],
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ont_upgrade_de.assistant_navigator (
    assistant_navigator_id uuid NOT NULL,
    lens_id uuid NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    description text,
    config_version integer NOT NULL,
    config jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ont_upgrade_de.assistant_retriever (
    assistant_retriever_id uuid NOT NULL,
    lens_id uuid NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    description text,
    config_version integer NOT NULL,
    config jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    warnings jsonb DEFAULT '[]'::jsonb NOT NULL
);

CREATE TABLE ont_upgrade_de.changeset (
    changeset_id uuid NOT NULL,
    lens_id uuid NOT NULL,
    number integer NOT NULL,
    ruleset_key text,
    version integer NOT NULL,
    note text,
    submitted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_change_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ont_upgrade_de.changeset_object (
    changeset_id uuid NOT NULL,
    object_id uuid NOT NULL,
    kind text NOT NULL,
    type_key text NOT NULL,
    action text NOT NULL,
    from_id uuid,
    to_id uuid,
    first_touched_at timestamp with time zone NOT NULL
);

CREATE TABLE ont_upgrade_de.changeset_value (
    changeset_id uuid NOT NULL,
    object_id uuid NOT NULL,
    property_key text NOT NULL,
    value jsonb NOT NULL,
    before jsonb,
    bytes integer NOT NULL
);

CREATE TABLE ont_upgrade_de.entity (
    id uuid NOT NULL,
    type_key text CONSTRAINT entity_type_key_not_null1 NOT NULL,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ont_upgrade_de.entity_type (
    entity_type_id uuid NOT NULL,
    key text NOT NULL,
    display_name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    name_property text NOT NULL
);

CREATE TABLE ont_upgrade_de.lens (
    lens_id uuid NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ont_upgrade_de.lens_includes (
    lens_id uuid NOT NULL,
    entity_type_id uuid,
    relation_type_id uuid,
    properties text[],
    search_index_id uuid,
    CONSTRAINT lens_includes_one_type CHECK ((num_nonnulls(entity_type_id, relation_type_id, search_index_id) = 1))
);

CREATE TABLE ont_upgrade_de.property_def (
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

CREATE TABLE ont_upgrade_de.relation (
    id uuid NOT NULL,
    type_key text CONSTRAINT relation_type_key_not_null1 NOT NULL,
    from_id uuid NOT NULL,
    to_id uuid NOT NULL,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ont_upgrade_de.relation_type (
    relation_type_id uuid NOT NULL,
    key text NOT NULL,
    display_name text NOT NULL,
    description text,
    source_entity_type_key text NOT NULL,
    target_entity_type_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    parent text
);

CREATE TABLE ont_upgrade_de.ruleset (
    key text NOT NULL,
    anchor_type_key text,
    anchor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    write_access text DEFAULT 'full'::text NOT NULL
);

CREATE TABLE ont_upgrade_de.saved_query (
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

CREATE TABLE ont_upgrade_de.search_entry (
    generation_id uuid NOT NULL,
    entity_id uuid NOT NULL,
    part_kind text NOT NULL,
    group_no integer NOT NULL,
    part_id text NOT NULL,
    relation_type text,
    target_type text,
    target_id uuid,
    start_char integer,
    char_length integer,
    text text NOT NULL,
    text_hash bytea NOT NULL,
    embedding public.halfvec,
    tsv tsvector
)
PARTITION BY LIST (generation_id);

CREATE TABLE ont_upgrade_de.se_e0b5c8efb092440c8756fc1250d85f2a (
    generation_id uuid CONSTRAINT search_entry_generation_id_not_null NOT NULL,
    entity_id uuid CONSTRAINT search_entry_entity_id_not_null NOT NULL,
    part_kind text CONSTRAINT search_entry_part_kind_not_null NOT NULL,
    group_no integer CONSTRAINT search_entry_group_no_not_null NOT NULL,
    part_id text CONSTRAINT search_entry_part_id_not_null NOT NULL,
    relation_type text,
    target_type text,
    target_id uuid,
    start_char integer,
    char_length integer,
    text text CONSTRAINT search_entry_text_not_null NOT NULL,
    text_hash bytea CONSTRAINT search_entry_text_hash_not_null NOT NULL,
    embedding public.halfvec,
    tsv tsvector
);

CREATE TABLE ont_upgrade_de.se_eb3523b85fc846cd943574d1224e335e (
    generation_id uuid CONSTRAINT search_entry_generation_id_not_null NOT NULL,
    entity_id uuid CONSTRAINT search_entry_entity_id_not_null NOT NULL,
    part_kind text CONSTRAINT search_entry_part_kind_not_null NOT NULL,
    group_no integer CONSTRAINT search_entry_group_no_not_null NOT NULL,
    part_id text CONSTRAINT search_entry_part_id_not_null NOT NULL,
    relation_type text,
    target_type text,
    target_id uuid,
    start_char integer,
    char_length integer,
    text text CONSTRAINT search_entry_text_not_null NOT NULL,
    text_hash bytea CONSTRAINT search_entry_text_hash_not_null NOT NULL,
    embedding public.halfvec,
    tsv tsvector
);

CREATE TABLE ont_upgrade_de.se_f49e0069377f49b8826cdfc2827abeed (
    generation_id uuid CONSTRAINT search_entry_generation_id_not_null NOT NULL,
    entity_id uuid CONSTRAINT search_entry_entity_id_not_null NOT NULL,
    part_kind text CONSTRAINT search_entry_part_kind_not_null NOT NULL,
    group_no integer CONSTRAINT search_entry_group_no_not_null NOT NULL,
    part_id text CONSTRAINT search_entry_part_id_not_null NOT NULL,
    relation_type text,
    target_type text,
    target_id uuid,
    start_char integer,
    char_length integer,
    text text CONSTRAINT search_entry_text_not_null NOT NULL,
    text_hash bytea CONSTRAINT search_entry_text_hash_not_null NOT NULL,
    embedding public.halfvec,
    tsv tsvector
);

CREATE TABLE ont_upgrade_de.search_generation (
    generation_id uuid NOT NULL,
    search_index_id uuid NOT NULL,
    representation text NOT NULL,
    definition_hash text NOT NULL,
    model_id text,
    dimensions integer,
    languages text[],
    state text NOT NULL,
    total integer DEFAULT 0 NOT NULL,
    done integer DEFAULT 0 NOT NULL,
    failed integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    ready_at timestamp with time zone,
    CONSTRAINT search_generation_representation_check CHECK ((representation = ANY (ARRAY['semantic'::text, 'keyword'::text]))),
    CONSTRAINT search_generation_state_check CHECK ((state = ANY (ARRAY['building'::text, 'ready'::text, 'retired'::text, 'failed'::text])))
);

CREATE TABLE ont_upgrade_de.search_index (
    search_index_id uuid NOT NULL,
    key text NOT NULL,
    kind text NOT NULL,
    entity_type_id uuid NOT NULL,
    definition jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT search_index_kind_check CHECK ((kind = ANY (ARRAY['default'::text, 'passage'::text, 'custom'::text])))
);

CREATE TABLE ont_upgrade_de.search_queue (
    generation_id uuid NOT NULL,
    entity_id uuid NOT NULL,
    part_kind text NOT NULL,
    group_no integer NOT NULL,
    part_id text NOT NULL,
    enqueued_at timestamp with time zone DEFAULT now() NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    not_before timestamp with time zone DEFAULT now() NOT NULL,
    lease_until timestamp with time zone,
    last_error text,
    last_error_at timestamp with time zone
);

CREATE TABLE ont_upgrade_de.search_settings (
    singleton boolean DEFAULT true NOT NULL,
    keyword_languages text[] NOT NULL,
    disabled_defaults jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT search_settings_singleton CHECK (singleton)
);

ALTER TABLE ONLY ont_upgrade.search_entry ATTACH PARTITION ont_upgrade.se_1b92cadc186a42b09bd6594ef250c956 FOR VALUES IN ('1b92cadc-186a-42b0-9bd6-594ef250c956');

ALTER TABLE ONLY ont_upgrade.search_entry ATTACH PARTITION ont_upgrade.se_72c78607f8674206ae7dfe4d5027af5d FOR VALUES IN ('72c78607-f867-4206-ae7d-fe4d5027af5d');

ALTER TABLE ONLY ont_upgrade.search_entry ATTACH PARTITION ont_upgrade.se_ae7ab2135ea04eecaa703032931d1b8a FOR VALUES IN ('ae7ab213-5ea0-4eec-aa70-3032931d1b8a');

ALTER TABLE ONLY ont_upgrade.search_entry ATTACH PARTITION ont_upgrade.se_b7c84078512b44ddb5b47305e609ab3e FOR VALUES IN ('b7c84078-512b-44dd-b5b4-7305e609ab3e');

ALTER TABLE ONLY ont_upgrade.search_entry ATTACH PARTITION ont_upgrade.se_bea3032f44ae4261b0219b0dea62f993 FOR VALUES IN ('bea3032f-44ae-4261-b021-9b0dea62f993');

ALTER TABLE ONLY ont_upgrade.search_entry ATTACH PARTITION ont_upgrade.se_cb975937c31b40b3a06223fd6ddae84d FOR VALUES IN ('cb975937-c31b-40b3-a062-23fd6ddae84d');

ALTER TABLE ONLY ont_upgrade_de.search_entry ATTACH PARTITION ont_upgrade_de.se_e0b5c8efb092440c8756fc1250d85f2a FOR VALUES IN ('e0b5c8ef-b092-440c-8756-fc1250d85f2a');

ALTER TABLE ONLY ont_upgrade_de.search_entry ATTACH PARTITION ont_upgrade_de.se_eb3523b85fc846cd943574d1224e335e FOR VALUES IN ('eb3523b8-5fc8-46cd-9435-74d1224e335e');

ALTER TABLE ONLY ont_upgrade_de.search_entry ATTACH PARTITION ont_upgrade_de.se_f49e0069377f49b8826cdfc2827abeed FOR VALUES IN ('f49e0069-377f-49b8-826c-dfc2827abeed');

INSERT INTO ont_upgrade.assistant_agent (assistant_agent_id, lens_id, key, name, description, system_prompt, tools, created_at, updated_at) VALUES ('1d60b0f2-4bd9-4175-b5c4-123e45df9460', 'a37e5244-7ceb-4e31-834a-daf7ab9d7974', 'helper', 'Helper', 'Answers questions', 'Be brief.', '{search,get_entity}', '2026-11-15 22:34:29.470504+00', '2026-11-15 22:34:29.470504+00');

INSERT INTO ont_upgrade.assistant_navigator (assistant_navigator_id, lens_id, key, name, description, config_version, config, created_at, updated_at) VALUES ('e2d23161-ba9b-45ab-ba7a-091c169bfec1', 'a37e5244-7ceb-4e31-834a-daf7ab9d7974', 'walker', 'Walker', 'Walks the hierarchy', 1, '{"hops": 2, "anchorTypes": ["customer", "project"], "maxEntities": 40, "instructions": null, "relationTypes": null}', '2026-11-15 22:34:29.514294+00', '2026-11-15 22:34:29.514294+00');

INSERT INTO ont_upgrade.assistant_retriever (assistant_retriever_id, lens_id, key, name, description, config_version, config, created_at, updated_at, warnings) VALUES ('6e9c596d-092e-4200-afbe-f1d5cedf59e8', 'a37e5244-7ceb-4e31-834a-daf7ab9d7974', 'task_finder', 'Task finder', 'Finds tasks', 2, '{"filters": [{"id": "project", "path": [{"direction": "incoming", "relationTypeKey": "has_task"}], "field": "code", "entityType": "task"}], "indices": [{"index": "task~default"}, {"index": "task~description"}, {"index": "task_assignee"}], "threshold": 0.4, "answerFields": {"task": ["name", "due"]}, "answerFieldCharacters": 500}', '2026-11-15 22:34:29.513211+00', '2026-11-15 22:34:29.513211+00', '[]');

INSERT INTO ont_upgrade.changeset (changeset_id, lens_id, number, ruleset_key, version, note, submitted_at, created_at, last_change_at) VALUES ('a336dd46-03a4-4a8c-9925-cee2de6766e0', 'a37e5244-7ceb-4e31-834a-daf7ab9d7974', 1, NULL, 3, 'Draft work', NULL, '2026-11-15 22:34:29.573198+00', '2026-11-15 22:34:29.583346+00');
INSERT INTO ont_upgrade.changeset (changeset_id, lens_id, number, ruleset_key, version, note, submitted_at, created_at, last_change_at) VALUES ('1de8455a-3985-4dd8-a1e0-5a603d04a5b8', 'a37e5244-7ceb-4e31-834a-daf7ab9d7974', 2, 'bridge_crew', 4, 'Ready for review', '2026-11-15 22:34:29.606588+00', '2026-11-15 22:34:29.587825+00', '2026-11-15 22:34:29.606588+00');

INSERT INTO ont_upgrade.changeset_object (changeset_id, object_id, kind, type_key, action, from_id, to_id, first_touched_at) VALUES ('a336dd46-03a4-4a8c-9925-cee2de6766e0', '20f66f31-3849-476a-8a8b-1f48457c1406', 'entity', 'task', 'update', NULL, NULL, '2026-11-15 22:34:29.580074+00');
INSERT INTO ont_upgrade.changeset_object (changeset_id, object_id, kind, type_key, action, from_id, to_id, first_touched_at) VALUES ('a336dd46-03a4-4a8c-9925-cee2de6766e0', '4a79bd43-56e5-486a-a9c4-9045dea08d8a', 'entity', 'person', 'create', NULL, NULL, '2026-11-15 22:34:29.583997+00');
INSERT INTO ont_upgrade.changeset_object (changeset_id, object_id, kind, type_key, action, from_id, to_id, first_touched_at) VALUES ('1de8455a-3985-4dd8-a1e0-5a603d04a5b8', '82c47746-1a82-4572-b3db-bba0a6c5b58b', 'entity', 'task', 'create', NULL, NULL, '2026-11-15 22:34:29.593509+00');
INSERT INTO ont_upgrade.changeset_object (changeset_id, object_id, kind, type_key, action, from_id, to_id, first_touched_at) VALUES ('1de8455a-3985-4dd8-a1e0-5a603d04a5b8', '3bb305a0-d95c-4b9c-a260-df00dd8f6774', 'relation', 'has_task', 'create', '035c7c74-6b7c-48a7-898c-36466262cc74', '82c47746-1a82-4572-b3db-bba0a6c5b58b', '2026-11-15 22:34:29.593683+00');
INSERT INTO ont_upgrade.changeset_object (changeset_id, object_id, kind, type_key, action, from_id, to_id, first_touched_at) VALUES ('1de8455a-3985-4dd8-a1e0-5a603d04a5b8', 'ca627b7c-347f-434e-adbd-9e16f90430cb', 'entity', 'task', 'update', NULL, NULL, '2026-11-15 22:34:29.600052+00');

INSERT INTO ont_upgrade.changeset_value (changeset_id, object_id, property_key, value, before, bytes) VALUES ('a336dd46-03a4-4a8c-9925-cee2de6766e0', '20f66f31-3849-476a-8a8b-1f48457c1406', 'due', '"2027-01-15"', '{}', 14);
INSERT INTO ont_upgrade.changeset_value (changeset_id, object_id, property_key, value, before, bytes) VALUES ('a336dd46-03a4-4a8c-9925-cee2de6766e0', '4a79bd43-56e5-486a-a9c4-9045dea08d8a', 'name', '"Cleo Park"', NULL, 11);
INSERT INTO ont_upgrade.changeset_value (changeset_id, object_id, property_key, value, before, bytes) VALUES ('1de8455a-3985-4dd8-a1e0-5a603d04a5b8', '82c47746-1a82-4572-b3db-bba0a6c5b58b', 'name', '"Paint railings"', NULL, 16);
INSERT INTO ont_upgrade.changeset_value (changeset_id, object_id, property_key, value, before, bytes) VALUES ('1de8455a-3985-4dd8-a1e0-5a603d04a5b8', '3bb305a0-d95c-4b9c-a260-df00dd8f6774', 'phase', '"finish"', NULL, 8);
INSERT INTO ont_upgrade.changeset_value (changeset_id, object_id, property_key, value, before, bytes) VALUES ('1de8455a-3985-4dd8-a1e0-5a603d04a5b8', 'ca627b7c-347f-434e-adbd-9e16f90430cb', 'description', '"# Survey\n\nMeasure the river banks on both sides and record the soil and water samples.\n\nThe report goes to the planning team and the customer."', '{"value": {"length": 125, "sha256": "066c47e76233db34341d2c514006205c72ac9f647985e22a1a507e101b951aec"}}', 248);

INSERT INTO ont_upgrade.entity (id, type_key, props, created_at, updated_at) VALUES ('c2409a2a-3d27-4aeb-82f8-b8e611baa82b', 'customer', '{"name": "ACME"}', '2026-11-15 22:34:29.522572+00', '2026-11-15 22:34:29.522572+00');
INSERT INTO ont_upgrade.entity (id, type_key, props, created_at, updated_at) VALUES ('39b2bbe2-fb76-40b9-ac4d-0b342c5b4285', 'customer', '{"name": "Beta Corp"}', '2026-11-15 22:34:29.525477+00', '2026-11-15 22:34:29.525477+00');
INSERT INTO ont_upgrade.entity (id, type_key, props, created_at, updated_at) VALUES ('035c7c74-6b7c-48a7-898c-36466262cc74', 'project', '{"code": "PRJ-1", "name": "Bridge", "budget": 1200.5}', '2026-11-15 22:34:29.529967+00', '2026-11-15 22:34:29.529967+00');
INSERT INTO ont_upgrade.entity (id, type_key, props, created_at, updated_at) VALUES ('bbf99c78-3f27-4230-a83f-dfd6be88e824', 'task', '{"done": true, "name": "Order steel"}', '2026-11-15 22:34:29.541605+00', '2026-11-15 22:34:29.541605+00');
INSERT INTO ont_upgrade.entity (id, type_key, props, created_at, updated_at) VALUES ('20f66f31-3849-476a-8a8b-1f48457c1406', 'task', '{"done": false, "name": "Drill pilot hole"}', '2026-11-15 22:34:29.545431+00', '2026-11-15 22:34:29.545431+00');
INSERT INTO ont_upgrade.entity (id, type_key, props, created_at, updated_at) VALUES ('210a90eb-7127-4f60-b8b0-d2e3367e1d02', 'person', '{"name": "Ada Lovelace", "email": "ada@example.com"}', '2026-11-15 22:34:29.548803+00', '2026-11-15 22:34:29.548803+00');
INSERT INTO ont_upgrade.entity (id, type_key, props, created_at, updated_at) VALUES ('3c9e4c9a-0418-4a56-8964-c34f6ff81e49', 'person', '{"name": "Ben Miller"}', '2026-11-15 22:34:29.551023+00', '2026-11-15 22:34:29.551023+00');
INSERT INTO ont_upgrade.entity (id, type_key, props, created_at, updated_at) VALUES ('ca627b7c-347f-434e-adbd-9e16f90430cb', 'task', '{"due": "2026-12-01", "done": false, "name": "Survey the site", "description": "# Survey\n\nMeasure the river banks on both sides and record the soil and water samples.\n\nThe report goes to the planning team.", "_doc_description_length": 125}', '2026-11-15 22:34:29.537284+00', '2026-11-15 22:34:29.565153+00');
INSERT INTO ont_upgrade.entity (id, type_key, props, created_at, updated_at) VALUES ('6c29767c-6fd7-43b7-9da2-c8bc45c041f1', 'project', '{"code": "PRJ-2", "name": "Tunnel", "budget": 800}', '2026-11-15 22:34:29.533633+00', '2026-11-15 22:34:29.617183+00');

INSERT INTO ont_upgrade.entity_type (entity_type_id, key, display_name, description, created_at, updated_at, name_property) VALUES ('d296c9b2-cef2-4601-8977-95c2a73f8df7', 'customer', 'Customer', 'A customer', '2026-11-15 22:34:29.455526+00', '2026-11-15 22:34:29.455526+00', 'name');
INSERT INTO ont_upgrade.entity_type (entity_type_id, key, display_name, description, created_at, updated_at, name_property) VALUES ('7da0e41d-70b0-4522-826b-a5c6100ca657', 'project', 'Project', NULL, '2026-11-15 22:34:29.457066+00', '2026-11-15 22:34:29.457066+00', 'name');
INSERT INTO ont_upgrade.entity_type (entity_type_id, key, display_name, description, created_at, updated_at, name_property) VALUES ('a6f981f0-e212-40fa-ac21-c34b42d18deb', 'task', 'Task', NULL, '2026-11-15 22:34:29.460487+00', '2026-11-15 22:34:29.460487+00', 'name');
INSERT INTO ont_upgrade.entity_type (entity_type_id, key, display_name, description, created_at, updated_at, name_property) VALUES ('04ec365f-db6d-4f22-ba79-7a1328ad409c', 'person', 'Person', NULL, '2026-11-15 22:34:29.463751+00', '2026-11-15 22:34:29.463751+00', 'name');

INSERT INTO ont_upgrade.lens (lens_id, key, name, description, created_at, updated_at) VALUES ('a37e5244-7ceb-4e31-834a-daf7ab9d7974', 'all', 'All', 'Everything', '2026-11-15 22:34:29.469807+00', '2026-11-15 22:34:29.469807+00');
INSERT INTO ont_upgrade.lens (lens_id, key, name, description, created_at, updated_at) VALUES ('1a7fd8a1-7739-4fd9-b5f2-90acbb9a1d50', 'planning', 'Planning', 'Customers and projects only', '2026-11-15 22:34:29.472934+00', '2026-11-15 22:34:29.472934+00');

INSERT INTO ont_upgrade.lens_includes (lens_id, entity_type_id, relation_type_id, properties, search_index_id) VALUES ('1a7fd8a1-7739-4fd9-b5f2-90acbb9a1d50', 'd296c9b2-cef2-4601-8977-95c2a73f8df7', NULL, NULL, NULL);
INSERT INTO ont_upgrade.lens_includes (lens_id, entity_type_id, relation_type_id, properties, search_index_id) VALUES ('1a7fd8a1-7739-4fd9-b5f2-90acbb9a1d50', '7da0e41d-70b0-4522-826b-a5c6100ca657', NULL, '{name,code}', NULL);
INSERT INTO ont_upgrade.lens_includes (lens_id, entity_type_id, relation_type_id, properties, search_index_id) VALUES ('1a7fd8a1-7739-4fd9-b5f2-90acbb9a1d50', NULL, 'ce8c8483-84b9-4190-8133-0b2575cfffd2', NULL, NULL);
INSERT INTO ont_upgrade.lens_includes (lens_id, entity_type_id, relation_type_id, properties, search_index_id) VALUES ('1a7fd8a1-7739-4fd9-b5f2-90acbb9a1d50', NULL, NULL, NULL, 'f09a6aad-f687-4b78-a045-056d26464713');
INSERT INTO ont_upgrade.lens_includes (lens_id, entity_type_id, relation_type_id, properties, search_index_id) VALUES ('1a7fd8a1-7739-4fd9-b5f2-90acbb9a1d50', NULL, NULL, NULL, 'da7179bb-01aa-44ea-ac1a-4d64280b19c9');

INSERT INTO ont_upgrade.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('ca41ac49-5f87-4dcd-8d4b-098e0df5f165', 'd296c9b2-cef2-4601-8977-95c2a73f8df7', NULL, 'name', 'Name', NULL, 'string', true, NULL, '2026-11-15 22:34:29.455526+00', '2026-11-15 22:34:29.455526+00');
INSERT INTO ont_upgrade.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('40107def-6a73-4067-a9b8-87e1ad62f420', '7da0e41d-70b0-4522-826b-a5c6100ca657', NULL, 'name', 'Name', NULL, 'string', true, NULL, '2026-11-15 22:34:29.457066+00', '2026-11-15 22:34:29.457066+00');
INSERT INTO ont_upgrade.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('98c2f98c-67e8-43c2-bd6a-4f88209f2b75', '7da0e41d-70b0-4522-826b-a5c6100ca657', NULL, 'code', 'Code', NULL, 'string', false, NULL, '2026-11-15 22:34:29.45856+00', '2026-11-15 22:34:29.45856+00');
INSERT INTO ont_upgrade.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('9d731564-c040-4b72-99af-06bf7820a405', '7da0e41d-70b0-4522-826b-a5c6100ca657', NULL, 'budget', 'Budget', NULL, 'float', false, NULL, '2026-11-15 22:34:29.459532+00', '2026-11-15 22:34:29.459532+00');
INSERT INTO ont_upgrade.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('191d4d0f-ca2d-44db-8ef8-21b83546e7b9', 'a6f981f0-e212-40fa-ac21-c34b42d18deb', NULL, 'name', 'Name', NULL, 'string', true, NULL, '2026-11-15 22:34:29.460487+00', '2026-11-15 22:34:29.460487+00');
INSERT INTO ont_upgrade.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('b8833e77-265c-4f91-9587-52752cae06ef', 'a6f981f0-e212-40fa-ac21-c34b42d18deb', NULL, 'description', 'Description', NULL, 'document', false, NULL, '2026-11-15 22:34:29.461557+00', '2026-11-15 22:34:29.461557+00');
INSERT INTO ont_upgrade.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('b2c0c5d0-1008-4fb7-b6e0-1d6a2fe67f98', 'a6f981f0-e212-40fa-ac21-c34b42d18deb', NULL, 'due', 'Due', NULL, 'date', false, NULL, '2026-11-15 22:34:29.462361+00', '2026-11-15 22:34:29.462361+00');
INSERT INTO ont_upgrade.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('1fcccd9e-6546-42b3-aed1-a1045849fc28', 'a6f981f0-e212-40fa-ac21-c34b42d18deb', NULL, 'done', 'Done', NULL, 'boolean', false, 'false', '2026-11-15 22:34:29.463062+00', '2026-11-15 22:34:29.463062+00');
INSERT INTO ont_upgrade.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('5b5f6758-86d7-4f3c-b11b-31b34ba21111', '04ec365f-db6d-4f22-ba79-7a1328ad409c', NULL, 'name', 'Name', NULL, 'string', true, NULL, '2026-11-15 22:34:29.463751+00', '2026-11-15 22:34:29.463751+00');
INSERT INTO ont_upgrade.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('98dee054-d0db-471d-a0f3-8bbb76856f6d', '04ec365f-db6d-4f22-ba79-7a1328ad409c', NULL, 'email', 'Email', NULL, 'string', false, NULL, '2026-11-15 22:34:29.464595+00', '2026-11-15 22:34:29.464595+00');
INSERT INTO ont_upgrade.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('a2b77c23-6492-477d-931d-5667222517b8', NULL, '84a16e55-1f6d-4e16-bbc2-29ec30775f1f', 'phase', 'Phase', NULL, 'string', true, NULL, '2026-11-15 22:34:29.467762+00', '2026-11-15 22:34:29.467762+00');
INSERT INTO ont_upgrade.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('0adfab13-29a5-4a44-b665-7596eaf0a91e', NULL, '0638c556-4bb1-40fa-99c7-e42dd741225b', 'role', 'Role', NULL, 'string', false, NULL, '2026-11-15 22:34:29.469149+00', '2026-11-15 22:34:29.469149+00');

INSERT INTO ont_upgrade.relation (id, type_key, from_id, to_id, props, created_at, updated_at) VALUES ('20bb6d5f-3c31-4866-84ec-7a26227c54dd', 'has_project', 'c2409a2a-3d27-4aeb-82f8-b8e611baa82b', '035c7c74-6b7c-48a7-898c-36466262cc74', '{}', '2026-11-15 22:34:29.529967+00', '2026-11-15 22:34:29.529967+00');
INSERT INTO ont_upgrade.relation (id, type_key, from_id, to_id, props, created_at, updated_at) VALUES ('b0fe3bc8-15c0-4756-9c1f-49a9c71e7801', 'has_project', '39b2bbe2-fb76-40b9-ac4d-0b342c5b4285', '6c29767c-6fd7-43b7-9da2-c8bc45c041f1', '{}', '2026-11-15 22:34:29.533633+00', '2026-11-15 22:34:29.533633+00');
INSERT INTO ont_upgrade.relation (id, type_key, from_id, to_id, props, created_at, updated_at) VALUES ('60ac95dd-6ac6-452a-bc28-dededf8b3f2a', 'has_task', '035c7c74-6b7c-48a7-898c-36466262cc74', 'ca627b7c-347f-434e-adbd-9e16f90430cb', '{"phase": "design"}', '2026-11-15 22:34:29.537284+00', '2026-11-15 22:34:29.537284+00');
INSERT INTO ont_upgrade.relation (id, type_key, from_id, to_id, props, created_at, updated_at) VALUES ('02ec0adc-ae47-4841-94e9-7218a17a1f6d', 'has_task', '035c7c74-6b7c-48a7-898c-36466262cc74', 'bbf99c78-3f27-4230-a83f-dfd6be88e824', '{"phase": "build"}', '2026-11-15 22:34:29.541605+00', '2026-11-15 22:34:29.541605+00');
INSERT INTO ont_upgrade.relation (id, type_key, from_id, to_id, props, created_at, updated_at) VALUES ('77905db2-9458-4b02-a425-a24a44f945bd', 'has_task', '6c29767c-6fd7-43b7-9da2-c8bc45c041f1', '20f66f31-3849-476a-8a8b-1f48457c1406', '{"phase": "build"}', '2026-11-15 22:34:29.545431+00', '2026-11-15 22:34:29.545431+00');
INSERT INTO ont_upgrade.relation (id, type_key, from_id, to_id, props, created_at, updated_at) VALUES ('bfff66fe-0eb4-48e5-b736-b88d4ed38751', 'assigned_to', 'ca627b7c-347f-434e-adbd-9e16f90430cb', '210a90eb-7127-4f60-b8b0-d2e3367e1d02', '{"role": "lead"}', '2026-11-15 22:34:29.554533+00', '2026-11-15 22:34:29.554533+00');
INSERT INTO ont_upgrade.relation (id, type_key, from_id, to_id, props, created_at, updated_at) VALUES ('8535c0b4-aebd-48a6-97f0-59431af975b1', 'assigned_to', 'ca627b7c-347f-434e-adbd-9e16f90430cb', '3c9e4c9a-0418-4a56-8964-c34f6ff81e49', '{}', '2026-11-15 22:34:29.558129+00', '2026-11-15 22:34:29.558129+00');
INSERT INTO ont_upgrade.relation (id, type_key, from_id, to_id, props, created_at, updated_at) VALUES ('b1bc5236-3f8d-4f50-8ac5-b571eedbad6d', 'assigned_to', '20f66f31-3849-476a-8a8b-1f48457c1406', '3c9e4c9a-0418-4a56-8964-c34f6ff81e49', '{"role": "driller"}', '2026-11-15 22:34:29.56169+00', '2026-11-15 22:34:29.56169+00');

INSERT INTO ont_upgrade.relation_type (relation_type_id, key, display_name, description, source_entity_type_key, target_entity_type_key, created_at, updated_at, parent) VALUES ('ce8c8483-84b9-4190-8133-0b2575cfffd2', 'has_project', 'Has project', NULL, 'customer', 'project', '2026-11-15 22:34:29.465256+00', '2026-11-15 22:34:29.465256+00', 'source');
INSERT INTO ont_upgrade.relation_type (relation_type_id, key, display_name, description, source_entity_type_key, target_entity_type_key, created_at, updated_at, parent) VALUES ('84a16e55-1f6d-4e16-bbc2-29ec30775f1f', 'has_task', 'Has task', NULL, 'project', 'task', '2026-11-15 22:34:29.466474+00', '2026-11-15 22:34:29.466474+00', 'source');
INSERT INTO ont_upgrade.relation_type (relation_type_id, key, display_name, description, source_entity_type_key, target_entity_type_key, created_at, updated_at, parent) VALUES ('0638c556-4bb1-40fa-99c7-e42dd741225b', 'assigned_to', 'Assigned to', NULL, 'task', 'person', '2026-11-15 22:34:29.468468+00', '2026-11-15 22:34:29.468468+00', NULL);

INSERT INTO ont_upgrade.ruleset (key, anchor_type_key, anchor_id, created_at, updated_at, write_access) VALUES ('bridge_crew', 'project', '035c7c74-6b7c-48a7-898c-36466262cc74', '2026-11-15 22:34:29.568412+00', '2026-11-15 22:34:29.568412+00', 'propose');
INSERT INTO ont_upgrade.ruleset (key, anchor_type_key, anchor_id, created_at, updated_at, write_access) VALUES ('office', NULL, NULL, '2026-11-15 22:34:29.570254+00', '2026-11-15 22:34:29.570254+00', 'full');

INSERT INTO ont_upgrade.saved_query (saved_query_id, lens_id, lens_key, key, name, description, steps, parameters, embedding, created_at, updated_at) VALUES ('68ee85ff-acd8-4270-a020-2dad10a3c2aa', 'a37e5244-7ceb-4e31-834a-daf7ab9d7974', 'all', 'tasks_by_text', 'Tasks by text', 'Search tasks, then fetch them', '[{"name":"found","type":"search","entityTypeKey":"task","query":"$q","limit":5},{"name":"tasks","type":"oql","oql":"MATCH (t:task) WHERE t._id IN $ids RETURN t.name","bindings":{"ids":"{{found._id}}"}}]', '[{"name":"q","description":"Search text","dataType":"string"}]', NULL, '2026-11-15 22:34:29.471391+00', '2026-11-15 22:34:29.471391+00');
INSERT INTO ont_upgrade.saved_query (saved_query_id, lens_id, lens_key, key, name, description, steps, parameters, embedding, created_at, updated_at) VALUES ('9dac0cac-23c4-44df-8462-7cda3f021a73', 'a37e5244-7ceb-4e31-834a-daf7ab9d7974', 'all', 'open_tasks', 'Open tasks', 'Tasks not done', '[{"name":"main","type":"oql","oql":"MATCH (t:task) WHERE t.done = false RETURN t"}]', '[]', NULL, '2026-11-15 22:34:29.472227+00', '2026-11-15 22:34:29.472227+00');
INSERT INTO ont_upgrade.saved_query (saved_query_id, lens_id, lens_key, key, name, description, steps, parameters, embedding, created_at, updated_at) VALUES ('1b14dd33-f4da-4847-b26f-44ea6cf10d93', '1a7fd8a1-7739-4fd9-b5f2-90acbb9a1d50', 'planning', 'projects_of', 'Projects of', 'Projects of a customer', '[{"name":"main","type":"oql","oql":"MATCH (c:customer)-[:has_project]->(p:project) WHERE c.name = $customer RETURN p"}]', '[{"name":"customer","description":"Customer name","dataType":"string"}]', NULL, '2026-11-15 22:34:29.475732+00', '2026-11-15 22:34:29.475732+00');

INSERT INTO ont_upgrade.se_1b92cadc186a42b09bd6594ef250c956 (generation_id, entity_id, part_kind, group_no, part_id, relation_type, target_type, target_id, start_char, char_length, text, text_hash, embedding, tsv) VALUES ('1b92cadc-186a-42b0-9bd6-594ef250c956', 'c2409a2a-3d27-4aeb-82f8-b8e611baa82b', 'self', 0, '', NULL, NULL, NULL, NULL, NULL, 'ACME', '\xe9cf2f2b11d90704db0cc3662e5a2395afc2797b257ba3b44dd79214c9db667a', NULL, '''acm'':1');
INSERT INTO ont_upgrade.se_1b92cadc186a42b09bd6594ef250c956 (generation_id, entity_id, part_kind, group_no, part_id, relation_type, target_type, target_id, start_char, char_length, text, text_hash, embedding, tsv) VALUES ('1b92cadc-186a-42b0-9bd6-594ef250c956', '39b2bbe2-fb76-40b9-ac4d-0b342c5b4285', 'self', 0, '', NULL, NULL, NULL, NULL, NULL, 'Beta Corp', '\x5417d892d380f24e3d6bf7838734802bdf00c3a10147e58439d0c6059c91c01f', NULL, '''beta'':1 ''corp'':2');

INSERT INTO ont_upgrade.se_72c78607f8674206ae7dfe4d5027af5d (generation_id, entity_id, part_kind, group_no, part_id, relation_type, target_type, target_id, start_char, char_length, text, text_hash, embedding, tsv) VALUES ('72c78607-f867-4206-ae7d-fe4d5027af5d', '035c7c74-6b7c-48a7-898c-36466262cc74', 'self', 0, '', NULL, NULL, NULL, NULL, NULL, 'Bridge
PRJ-1', '\xaae1ee5e3c5ddd43ad468f37e25839a8933a12348e80b172eed114b394ddfc70', NULL, '''-1'':3 ''bridg'':1 ''prj'':2');
INSERT INTO ont_upgrade.se_72c78607f8674206ae7dfe4d5027af5d (generation_id, entity_id, part_kind, group_no, part_id, relation_type, target_type, target_id, start_char, char_length, text, text_hash, embedding, tsv) VALUES ('72c78607-f867-4206-ae7d-fe4d5027af5d', '6c29767c-6fd7-43b7-9da2-c8bc45c041f1', 'self', 0, '', NULL, NULL, NULL, NULL, NULL, 'Tunnel
PRJ-2', '\xc411b9ed5928ab62cb35899a49d35bd995f4d8d3263f94b47d8017b9e8d9363a', NULL, '''-2'':3 ''prj'':2 ''tunnel'':1');

INSERT INTO ont_upgrade.se_ae7ab2135ea04eecaa703032931d1b8a (generation_id, entity_id, part_kind, group_no, part_id, relation_type, target_type, target_id, start_char, char_length, text, text_hash, embedding, tsv) VALUES ('ae7ab213-5ea0-4eec-aa70-3032931d1b8a', '210a90eb-7127-4f60-b8b0-d2e3367e1d02', 'self', 0, '', NULL, NULL, NULL, NULL, NULL, 'Ada Lovelace
ada@example.com', '\xc800277352b23e6ec60fc19b5dc2ad4e18954aa74edb7500a6d04edb7b0e90b5', NULL, '''ada'':1 ''ada@example.com'':3 ''lovelac'':2');
INSERT INTO ont_upgrade.se_ae7ab2135ea04eecaa703032931d1b8a (generation_id, entity_id, part_kind, group_no, part_id, relation_type, target_type, target_id, start_char, char_length, text, text_hash, embedding, tsv) VALUES ('ae7ab213-5ea0-4eec-aa70-3032931d1b8a', '3c9e4c9a-0418-4a56-8964-c34f6ff81e49', 'self', 0, '', NULL, NULL, NULL, NULL, NULL, 'Ben Miller', '\x3ac822dc7b469b09b61e7b8e0b2176f772931cc662a5645d51b4d2a30f514ae4', NULL, '''ben'':1 ''miller'':2');

INSERT INTO ont_upgrade.se_b7c84078512b44ddb5b47305e609ab3e (generation_id, entity_id, part_kind, group_no, part_id, relation_type, target_type, target_id, start_char, char_length, text, text_hash, embedding, tsv) VALUES ('b7c84078-512b-44dd-b5b4-7305e609ab3e', 'ca627b7c-347f-434e-adbd-9e16f90430cb', 'passage', 0, '0', NULL, NULL, NULL, 0, 125, 'Survey the site
# Survey

Measure the river banks on both sides and record the soil and water samples.

The report goes to the planning team.', '\x513410d7c9c49b0fd6d098cf50e1cec24fcc14f1a72a5eab10ee9569eab280d8', NULL, '''bank'':8 ''goe'':21 ''measur'':5 ''plan'':24 ''record'':13 ''report'':20 ''river'':7 ''sampl'':18 ''side'':11 ''site'':3 ''soil'':15 ''survey'':1,4 ''team'':25 ''water'':17');

INSERT INTO ont_upgrade.se_bea3032f44ae4261b0219b0dea62f993 (generation_id, entity_id, part_kind, group_no, part_id, relation_type, target_type, target_id, start_char, char_length, text, text_hash, embedding, tsv) VALUES ('bea3032f-44ae-4261-b021-9b0dea62f993', 'ca627b7c-347f-434e-adbd-9e16f90430cb', 'self', 0, '', NULL, NULL, NULL, NULL, NULL, 'Survey the site', '\xcd2851853f90c6faa9a858b1013be8d5aa565da25054a3a62364cf07b20c3f5d', NULL, '''site'':3 ''survey'':1');
INSERT INTO ont_upgrade.se_bea3032f44ae4261b0219b0dea62f993 (generation_id, entity_id, part_kind, group_no, part_id, relation_type, target_type, target_id, start_char, char_length, text, text_hash, embedding, tsv) VALUES ('bea3032f-44ae-4261-b021-9b0dea62f993', 'bbf99c78-3f27-4230-a83f-dfd6be88e824', 'self', 0, '', NULL, NULL, NULL, NULL, NULL, 'Order steel', '\x48b57d64ca47de976e949840f780d1289498bffbaeb7133c9f2363a681294587', NULL, '''order'':1 ''steel'':2');
INSERT INTO ont_upgrade.se_bea3032f44ae4261b0219b0dea62f993 (generation_id, entity_id, part_kind, group_no, part_id, relation_type, target_type, target_id, start_char, char_length, text, text_hash, embedding, tsv) VALUES ('bea3032f-44ae-4261-b021-9b0dea62f993', '20f66f31-3849-476a-8a8b-1f48457c1406', 'self', 0, '', NULL, NULL, NULL, NULL, NULL, 'Drill pilot hole', '\xf842034826577263e5550a901f1b51d8e8b64d2ba9bde66fd2cf150077a8fdbc', NULL, '''drill'':1 ''hole'':3 ''pilot'':2');

INSERT INTO ont_upgrade.se_cb975937c31b40b3a06223fd6ddae84d (generation_id, entity_id, part_kind, group_no, part_id, relation_type, target_type, target_id, start_char, char_length, text, text_hash, embedding, tsv) VALUES ('cb975937-c31b-40b3-a062-23fd6ddae84d', 'ca627b7c-347f-434e-adbd-9e16f90430cb', 'self', 0, '', NULL, NULL, NULL, NULL, NULL, 'Survey the site', '\xcd2851853f90c6faa9a858b1013be8d5aa565da25054a3a62364cf07b20c3f5d', NULL, '''site'':3 ''survey'':1');
INSERT INTO ont_upgrade.se_cb975937c31b40b3a06223fd6ddae84d (generation_id, entity_id, part_kind, group_no, part_id, relation_type, target_type, target_id, start_char, char_length, text, text_hash, embedding, tsv) VALUES ('cb975937-c31b-40b3-a062-23fd6ddae84d', 'ca627b7c-347f-434e-adbd-9e16f90430cb', 'relation', 0, 'bfff66fe-0eb4-48e5-b736-b88d4ed38751', 'assigned_to', 'person', '210a90eb-7127-4f60-b8b0-d2e3367e1d02', NULL, NULL, 'Survey the site
lead
Ada Lovelace', '\x12756e4181a8a43dce02a4b5471c0aac9de9179ec903e2fe2f6a9a41f0a62a9c', NULL, '''ada'':5 ''lead'':4 ''lovelac'':6 ''site'':3 ''survey'':1');
INSERT INTO ont_upgrade.se_cb975937c31b40b3a06223fd6ddae84d (generation_id, entity_id, part_kind, group_no, part_id, relation_type, target_type, target_id, start_char, char_length, text, text_hash, embedding, tsv) VALUES ('cb975937-c31b-40b3-a062-23fd6ddae84d', 'ca627b7c-347f-434e-adbd-9e16f90430cb', 'relation', 0, '8535c0b4-aebd-48a6-97f0-59431af975b1', 'assigned_to', 'person', '3c9e4c9a-0418-4a56-8964-c34f6ff81e49', NULL, NULL, 'Survey the site
Ben Miller', '\xbbe56fbd9cccf5cc06d01a31e340f7a0b7b3c9298fc182ddb3a452fb94754698', NULL, '''ben'':4 ''miller'':5 ''site'':3 ''survey'':1');
INSERT INTO ont_upgrade.se_cb975937c31b40b3a06223fd6ddae84d (generation_id, entity_id, part_kind, group_no, part_id, relation_type, target_type, target_id, start_char, char_length, text, text_hash, embedding, tsv) VALUES ('cb975937-c31b-40b3-a062-23fd6ddae84d', 'bbf99c78-3f27-4230-a83f-dfd6be88e824', 'self', 0, '', NULL, NULL, NULL, NULL, NULL, 'Order steel', '\x48b57d64ca47de976e949840f780d1289498bffbaeb7133c9f2363a681294587', NULL, '''order'':1 ''steel'':2');
INSERT INTO ont_upgrade.se_cb975937c31b40b3a06223fd6ddae84d (generation_id, entity_id, part_kind, group_no, part_id, relation_type, target_type, target_id, start_char, char_length, text, text_hash, embedding, tsv) VALUES ('cb975937-c31b-40b3-a062-23fd6ddae84d', '20f66f31-3849-476a-8a8b-1f48457c1406', 'self', 0, '', NULL, NULL, NULL, NULL, NULL, 'Drill pilot hole', '\xf842034826577263e5550a901f1b51d8e8b64d2ba9bde66fd2cf150077a8fdbc', NULL, '''drill'':1 ''hole'':3 ''pilot'':2');
INSERT INTO ont_upgrade.se_cb975937c31b40b3a06223fd6ddae84d (generation_id, entity_id, part_kind, group_no, part_id, relation_type, target_type, target_id, start_char, char_length, text, text_hash, embedding, tsv) VALUES ('cb975937-c31b-40b3-a062-23fd6ddae84d', '20f66f31-3849-476a-8a8b-1f48457c1406', 'relation', 0, 'b1bc5236-3f8d-4f50-8ac5-b571eedbad6d', 'assigned_to', 'person', '3c9e4c9a-0418-4a56-8964-c34f6ff81e49', NULL, NULL, 'Drill pilot hole
driller
Ben Miller', '\x8fcf3dc0dba1307abd6d9eaeb02540c8996fa7a673e3b4dab7a10ae0918a21a5', NULL, '''ben'':5 ''drill'':1 ''driller'':4 ''hole'':3 ''miller'':6 ''pilot'':2');

INSERT INTO ont_upgrade.search_generation (generation_id, search_index_id, representation, definition_hash, model_id, dimensions, languages, state, total, done, failed, created_at, ready_at) VALUES ('ae7ab213-5ea0-4eec-aa70-3032931d1b8a', '0023bfe8-f57c-4d78-ba3f-79c423980886', 'keyword', '4898c38d69829f376e7bd32b3780c9931b3c1ef741647dc52eeaab6e59fc8a7f', NULL, NULL, '{english}', 'ready', 0, 0, 0, '2026-11-15 22:34:29.497709+00', '2026-11-15 22:34:29.539917+00');
INSERT INTO ont_upgrade.search_generation (generation_id, search_index_id, representation, definition_hash, model_id, dimensions, languages, state, total, done, failed, created_at, ready_at) VALUES ('cb975937-c31b-40b3-a062-23fd6ddae84d', '3d85e58d-112a-4201-ac8c-7250bc620c41', 'keyword', '7f5939444f3463546dd3f20fbc754be7388706f24932871fe01ee73a83a2fd69', NULL, NULL, '{english}', 'ready', 0, 0, 0, '2026-11-15 22:34:29.503985+00', '2026-11-15 22:34:29.544251+00');
INSERT INTO ont_upgrade.search_generation (generation_id, search_index_id, representation, definition_hash, model_id, dimensions, languages, state, total, done, failed, created_at, ready_at) VALUES ('bea3032f-44ae-4261-b021-9b0dea62f993', 'ceb60233-17dc-47d4-91b5-c0f60c0bdb8e', 'keyword', 'f29906259619d42e43932de02228ecc5b78d5b268bb95a2a6f410d567ca7ff99', NULL, NULL, '{english}', 'ready', 0, 0, 0, '2026-11-15 22:34:29.506615+00', '2026-11-15 22:34:29.548032+00');
INSERT INTO ont_upgrade.search_generation (generation_id, search_index_id, representation, definition_hash, model_id, dimensions, languages, state, total, done, failed, created_at, ready_at) VALUES ('b7c84078-512b-44dd-b5b4-7305e609ab3e', 'baeb5ae8-d8a7-4cc3-aa40-2363953616ef', 'keyword', '72189a3e195db171cdd103484f3e60d154020595d8f1e5d54b810b8458b7d84c', NULL, NULL, '{english}', 'ready', 0, 0, 0, '2026-11-15 22:34:29.50928+00', '2026-11-15 22:34:29.551742+00');
INSERT INTO ont_upgrade.search_generation (generation_id, search_index_id, representation, definition_hash, model_id, dimensions, languages, state, total, done, failed, created_at, ready_at) VALUES ('1b92cadc-186a-42b0-9bd6-594ef250c956', 'f09a6aad-f687-4b78-a045-056d26464713', 'keyword', '790e069c35847a3827c88ca488ad7aebc4a00ffe60f86abb79501a78fc400422', NULL, NULL, '{english}', 'ready', 0, 2, 0, '2026-11-15 22:34:29.493694+00', '2026-11-15 22:34:29.625487+00');
INSERT INTO ont_upgrade.search_generation (generation_id, search_index_id, representation, definition_hash, model_id, dimensions, languages, state, total, done, failed, created_at, ready_at) VALUES ('72c78607-f867-4206-ae7d-fe4d5027af5d', 'da7179bb-01aa-44ea-ac1a-4d64280b19c9', 'keyword', 'cc7675f0b26c469991f70b32deaccb7930f9d5db63b4d4fbef7519353671c96f', NULL, NULL, '{english}', 'ready', 0, 2, 0, '2026-11-15 22:34:29.500799+00', '2026-11-15 22:34:29.628674+00');

INSERT INTO ont_upgrade.search_index (search_index_id, key, kind, entity_type_id, definition, created_at, updated_at) VALUES ('3d85e58d-112a-4201-ac8c-7250bc620c41', 'task_assignee', 'custom', 'a6f981f0-e212-40fa-ac21-c34b42d18deb', '{"key": "task_assignee", "name": "Tasks by assignee", "fields": ["name"], "header": null, "keyword": {"enabled": true}, "semantic": {"enabled": true, "template": null}, "relations": [{"label": "Assignee", "fields": ["role"], "target": {"person": ["name"]}, "template": null, "direction": "outgoing", "relationType": "assigned_to"}], "entityType": "task", "description": "Tasks with the people assigned to them."}', '2026-11-15 22:34:29.477698+00', '2026-11-15 22:34:29.477698+00');
INSERT INTO ont_upgrade.search_index (search_index_id, key, kind, entity_type_id, definition, created_at, updated_at) VALUES ('f09a6aad-f687-4b78-a045-056d26464713', 'customer~default', 'default', 'd296c9b2-cef2-4601-8977-95c2a73f8df7', '{"key": "customer~default", "name": "Customer — default", "fields": ["name"], "header": [], "keyword": {"enabled": true}, "semantic": {"enabled": true, "template": null}, "relations": [], "entityType": "customer", "description": "Finds Customer entities by their own text properties: Name."}', '2026-11-15 22:34:29.479794+00', '2026-11-15 22:34:29.479794+00');
INSERT INTO ont_upgrade.search_index (search_index_id, key, kind, entity_type_id, definition, created_at, updated_at) VALUES ('0023bfe8-f57c-4d78-ba3f-79c423980886', 'person~default', 'default', '04ec365f-db6d-4f22-ba79-7a1328ad409c', '{"key": "person~default", "name": "Person — default", "fields": ["email", "name"], "header": [], "keyword": {"enabled": true}, "semantic": {"enabled": true, "template": null}, "relations": [], "entityType": "person", "description": "Finds Person entities by their own text properties: Email, Name."}', '2026-11-15 22:34:29.481673+00', '2026-11-15 22:34:29.481673+00');
INSERT INTO ont_upgrade.search_index (search_index_id, key, kind, entity_type_id, definition, created_at, updated_at) VALUES ('da7179bb-01aa-44ea-ac1a-4d64280b19c9', 'project~default', 'default', '7da0e41d-70b0-4522-826b-a5c6100ca657', '{"key": "project~default", "name": "Project — default", "fields": ["code", "name"], "header": [], "keyword": {"enabled": true}, "semantic": {"enabled": true, "template": null}, "relations": [], "entityType": "project", "description": "Finds Project entities by their own text properties: Code, Name."}', '2026-11-15 22:34:29.483051+00', '2026-11-15 22:34:29.483051+00');
INSERT INTO ont_upgrade.search_index (search_index_id, key, kind, entity_type_id, definition, created_at, updated_at) VALUES ('ceb60233-17dc-47d4-91b5-c0f60c0bdb8e', 'task~default', 'default', 'a6f981f0-e212-40fa-ac21-c34b42d18deb', '{"key": "task~default", "name": "Task — default", "fields": ["name"], "header": [], "keyword": {"enabled": true}, "semantic": {"enabled": true, "template": null}, "relations": [], "entityType": "task", "description": "Finds Task entities by their own text properties: Name."}', '2026-11-15 22:34:29.484604+00', '2026-11-15 22:34:29.484604+00');
INSERT INTO ont_upgrade.search_index (search_index_id, key, kind, entity_type_id, definition, created_at, updated_at) VALUES ('baeb5ae8-d8a7-4cc3-aa40-2363953616ef', 'task~description', 'passage', 'a6f981f0-e212-40fa-ac21-c34b42d18deb', '{"key": "task~description", "name": "Task — Description passages", "fields": ["description"], "header": null, "keyword": {"enabled": true}, "semantic": {"enabled": true, "template": null}, "relations": [], "entityType": "task", "description": "Finds Task entities by passages of their Description document; each passage starts with the entity''s name."}', '2026-11-15 22:34:29.485907+00', '2026-11-15 22:34:29.485907+00');

INSERT INTO ont_upgrade.search_settings (singleton, keyword_languages, disabled_defaults) VALUES (true, '{english}', '{}');

INSERT INTO ont_upgrade_de.assistant_agent (assistant_agent_id, lens_id, key, name, description, system_prompt, tools, created_at, updated_at) VALUES ('aa25d7b4-9cf8-4c46-b7d4-520e5e1112ee', '374e11f9-0eaa-4bb4-ab9f-18c970cdf20d', 'berater', 'Berater', NULL, NULL, NULL, '2026-11-15 22:34:29.6501+00', '2026-11-15 22:34:29.6501+00');

INSERT INTO ont_upgrade_de.entity (id, type_key, props, created_at, updated_at) VALUES ('45ae5aea-82d7-4cce-a2a2-2b918cd50818', 'ort', '{"einwohner": 3755251, "bezeichnung": "Berlin"}', '2026-11-15 22:34:29.678696+00', '2026-11-15 22:34:29.678696+00');
INSERT INTO ont_upgrade_de.entity (id, type_key, props, created_at, updated_at) VALUES ('b495a849-8a28-4de8-ba44-5d8d03d60295', 'ort', '{"bezeichnung": "Köln"}', '2026-11-15 22:34:29.680484+00', '2026-11-15 22:34:29.680484+00');
INSERT INTO ont_upgrade_de.entity (id, type_key, props, created_at, updated_at) VALUES ('f210e037-33cd-4a85-92d9-f540933c0085', 'dokument', '{"titel": "Stadtführung", "inhalt": "Die Führungen beginnen täglich am Brandenburger Tor.\n\nTreffpunkt ist der Pariser Platz.", "_doc_inhalt_length": 87}', '2026-11-15 22:34:29.68236+00', '2026-11-15 22:34:29.68236+00');
INSERT INTO ont_upgrade_de.entity (id, type_key, props, created_at, updated_at) VALUES ('4438f101-5c28-47fa-aa31-79f51ee729ed', 'dokument', '{"titel": "Domblick", "inhalt": "Vom Rheinufer aus sieht man die Türme des Doms.", "_doc_inhalt_length": 47}', '2026-11-15 22:34:29.684509+00', '2026-11-15 22:34:29.684509+00');

INSERT INTO ont_upgrade_de.entity_type (entity_type_id, key, display_name, description, created_at, updated_at, name_property) VALUES ('e4a8f6e1-b41b-4d64-8ea0-a1f6f984c263', 'dokument', 'Dokument', NULL, '2026-11-15 22:34:29.64415+00', '2026-11-15 22:34:29.64415+00', 'titel');
INSERT INTO ont_upgrade_de.entity_type (entity_type_id, key, display_name, description, created_at, updated_at, name_property) VALUES ('7a8fab89-25b5-4682-813e-423078500a96', 'ort', 'Ort', NULL, '2026-11-15 22:34:29.646772+00', '2026-11-15 22:34:29.646772+00', 'bezeichnung');

INSERT INTO ont_upgrade_de.lens (lens_id, key, name, description, created_at, updated_at) VALUES ('374e11f9-0eaa-4bb4-ab9f-18c970cdf20d', 'alles', 'Alles', NULL, '2026-11-15 22:34:29.649056+00', '2026-11-15 22:34:29.649056+00');
INSERT INTO ont_upgrade_de.lens (lens_id, key, name, description, created_at, updated_at) VALUES ('43da3030-dde4-44a1-b138-b5740a4f3c5c', 'kurz', 'Kurz', 'Ohne Inhalte', '2026-11-15 22:34:29.651185+00', '2026-11-15 22:34:29.651185+00');

INSERT INTO ont_upgrade_de.lens_includes (lens_id, entity_type_id, relation_type_id, properties, search_index_id) VALUES ('43da3030-dde4-44a1-b138-b5740a4f3c5c', 'e4a8f6e1-b41b-4d64-8ea0-a1f6f984c263', NULL, '{titel}', NULL);
INSERT INTO ont_upgrade_de.lens_includes (lens_id, entity_type_id, relation_type_id, properties, search_index_id) VALUES ('43da3030-dde4-44a1-b138-b5740a4f3c5c', '7a8fab89-25b5-4682-813e-423078500a96', NULL, NULL, NULL);
INSERT INTO ont_upgrade_de.lens_includes (lens_id, entity_type_id, relation_type_id, properties, search_index_id) VALUES ('43da3030-dde4-44a1-b138-b5740a4f3c5c', NULL, '371f9971-fe42-4d59-97ac-2fc8f5c02e35', NULL, NULL);
INSERT INTO ont_upgrade_de.lens_includes (lens_id, entity_type_id, relation_type_id, properties, search_index_id) VALUES ('43da3030-dde4-44a1-b138-b5740a4f3c5c', NULL, NULL, NULL, '410e8e01-b3db-4272-938c-9a1dc09ae275');
INSERT INTO ont_upgrade_de.lens_includes (lens_id, entity_type_id, relation_type_id, properties, search_index_id) VALUES ('43da3030-dde4-44a1-b138-b5740a4f3c5c', NULL, NULL, NULL, '20430653-b09e-4a98-ab91-40f4fd1159a8');

INSERT INTO ont_upgrade_de.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('c8ed612b-985d-4fd0-9b17-13de0ca05571', 'e4a8f6e1-b41b-4d64-8ea0-a1f6f984c263', NULL, 'titel', 'Titel', NULL, 'string', true, NULL, '2026-11-15 22:34:29.64415+00', '2026-11-15 22:34:29.64415+00');
INSERT INTO ont_upgrade_de.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('a4033ee1-9686-459c-bff6-f69cbe2a3900', 'e4a8f6e1-b41b-4d64-8ea0-a1f6f984c263', NULL, 'inhalt', 'Inhalt', NULL, 'document', false, NULL, '2026-11-15 22:34:29.645892+00', '2026-11-15 22:34:29.645892+00');
INSERT INTO ont_upgrade_de.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('901969de-914a-46c6-8550-0f5968295703', '7a8fab89-25b5-4682-813e-423078500a96', NULL, 'bezeichnung', 'Bezeichnung', NULL, 'string', true, NULL, '2026-11-15 22:34:29.646772+00', '2026-11-15 22:34:29.646772+00');
INSERT INTO ont_upgrade_de.property_def (property_id, entity_type_id, relation_type_id, key, display_name, description, data_type, required, default_value, created_at, updated_at) VALUES ('e2bdd4e9-ddba-46c1-a146-7a4446afd46a', '7a8fab89-25b5-4682-813e-423078500a96', NULL, 'einwohner', 'Einwohner', NULL, 'integer', false, NULL, '2026-11-15 22:34:29.647578+00', '2026-11-15 22:34:29.647578+00');

INSERT INTO ont_upgrade_de.relation (id, type_key, from_id, to_id, props, created_at, updated_at) VALUES ('40f1284f-a28b-465e-93bb-e687bda8a150', 'liegt_in', 'f210e037-33cd-4a85-92d9-f540933c0085', '45ae5aea-82d7-4cce-a2a2-2b918cd50818', '{}', '2026-11-15 22:34:29.687396+00', '2026-11-15 22:34:29.687396+00');
INSERT INTO ont_upgrade_de.relation (id, type_key, from_id, to_id, props, created_at, updated_at) VALUES ('41c11b4d-99b8-4aa1-a06f-7f8af5d4ec1b', 'liegt_in', '4438f101-5c28-47fa-aa31-79f51ee729ed', 'b495a849-8a28-4de8-ba44-5d8d03d60295', '{}', '2026-11-15 22:34:29.689966+00', '2026-11-15 22:34:29.689966+00');

INSERT INTO ont_upgrade_de.relation_type (relation_type_id, key, display_name, description, source_entity_type_key, target_entity_type_key, created_at, updated_at, parent) VALUES ('371f9971-fe42-4d59-97ac-2fc8f5c02e35', 'liegt_in', 'Liegt in', NULL, 'dokument', 'ort', '2026-11-15 22:34:29.648244+00', '2026-11-15 22:34:29.648244+00', NULL);

INSERT INTO ont_upgrade_de.se_e0b5c8efb092440c8756fc1250d85f2a (generation_id, entity_id, part_kind, group_no, part_id, relation_type, target_type, target_id, start_char, char_length, text, text_hash, embedding, tsv) VALUES ('e0b5c8ef-b092-440c-8756-fc1250d85f2a', 'f210e037-33cd-4a85-92d9-f540933c0085', 'self', 0, '', NULL, NULL, NULL, NULL, NULL, 'Stadtführung', '\x7a07a2e47254806b9859c29af314c17ccacf7038a988e3654f2e10f271634549', NULL, '''stadtfuhr'':1');
INSERT INTO ont_upgrade_de.se_e0b5c8efb092440c8756fc1250d85f2a (generation_id, entity_id, part_kind, group_no, part_id, relation_type, target_type, target_id, start_char, char_length, text, text_hash, embedding, tsv) VALUES ('e0b5c8ef-b092-440c-8756-fc1250d85f2a', '4438f101-5c28-47fa-aa31-79f51ee729ed', 'self', 0, '', NULL, NULL, NULL, NULL, NULL, 'Domblick', '\x9f29b848668324ca2c3e1c45ca3c7b7c56972bd899f9bb9f9422cd51b24ce1c5', NULL, '''domblick'':1');

INSERT INTO ont_upgrade_de.se_eb3523b85fc846cd943574d1224e335e (generation_id, entity_id, part_kind, group_no, part_id, relation_type, target_type, target_id, start_char, char_length, text, text_hash, embedding, tsv) VALUES ('eb3523b8-5fc8-46cd-9435-74d1224e335e', '45ae5aea-82d7-4cce-a2a2-2b918cd50818', 'self', 0, '', NULL, NULL, NULL, NULL, NULL, 'Berlin', '\x84ef13306d1db22567570904a296780ccf853443824b6fb3403f5968651a1014', NULL, '''berlin'':1');
INSERT INTO ont_upgrade_de.se_eb3523b85fc846cd943574d1224e335e (generation_id, entity_id, part_kind, group_no, part_id, relation_type, target_type, target_id, start_char, char_length, text, text_hash, embedding, tsv) VALUES ('eb3523b8-5fc8-46cd-9435-74d1224e335e', 'b495a849-8a28-4de8-ba44-5d8d03d60295', 'self', 0, '', NULL, NULL, NULL, NULL, NULL, 'Köln', '\x22e6f07693a41fdda5837dbd93b6bf757663d87df298c0e5442342097fa70080', NULL, '''koln'':1');

INSERT INTO ont_upgrade_de.se_f49e0069377f49b8826cdfc2827abeed (generation_id, entity_id, part_kind, group_no, part_id, relation_type, target_type, target_id, start_char, char_length, text, text_hash, embedding, tsv) VALUES ('f49e0069-377f-49b8-826c-dfc2827abeed', 'f210e037-33cd-4a85-92d9-f540933c0085', 'passage', 0, '0', NULL, NULL, NULL, 0, 87, 'Stadtführung
Die Führungen beginnen täglich am Brandenburger Tor.

Treffpunkt ist der Pariser Platz.', '\x403ec646f36e85909a3b1cca7d46523404b72745ccde1525e1a7c2a4bac29b3c', NULL, '''beginn'':4 ''brandenburg'':7 ''fuhrung'':3 ''paris'':12 ''platz'':13 ''stadtfuhr'':1 ''taglich'':5 ''tor'':8 ''treffpunkt'':9');
INSERT INTO ont_upgrade_de.se_f49e0069377f49b8826cdfc2827abeed (generation_id, entity_id, part_kind, group_no, part_id, relation_type, target_type, target_id, start_char, char_length, text, text_hash, embedding, tsv) VALUES ('f49e0069-377f-49b8-826c-dfc2827abeed', '4438f101-5c28-47fa-aa31-79f51ee729ed', 'passage', 0, '0', NULL, NULL, NULL, 0, 47, 'Domblick
Vom Rheinufer aus sieht man die Türme des Doms.', '\xa6b9787c214fdcb71eba6a1cff69512280b23c41608b6ebaf2337698c18ed350', NULL, '''dom'':10 ''domblick'':1 ''rheinuf'':3 ''sieht'':5 ''turm'':8');

INSERT INTO ont_upgrade_de.search_generation (generation_id, search_index_id, representation, definition_hash, model_id, dimensions, languages, state, total, done, failed, created_at, ready_at) VALUES ('eb3523b8-5fc8-46cd-9435-74d1224e335e', '20430653-b09e-4a98-ab91-40f4fd1159a8', 'keyword', '82dcda7bbeb645aa26a9b519c9b39f720827dc807ecbf2fc6336e478a3dced85', NULL, NULL, '{german}', 'ready', 0, 2, 0, '2026-11-15 22:34:29.670918+00', '2026-11-15 22:34:29.695813+00');
INSERT INTO ont_upgrade_de.search_generation (generation_id, search_index_id, representation, definition_hash, model_id, dimensions, languages, state, total, done, failed, created_at, ready_at) VALUES ('e0b5c8ef-b092-440c-8756-fc1250d85f2a', '410e8e01-b3db-4272-938c-9a1dc09ae275', 'keyword', '8a87ec2b0b9d366122beda7a89136c46b2b310649ffd0c8affda5285a9e0fcdf', NULL, NULL, '{german}', 'ready', 0, 2, 0, '2026-11-15 22:34:29.666084+00', '2026-11-15 22:34:29.721105+00');
INSERT INTO ont_upgrade_de.search_generation (generation_id, search_index_id, representation, definition_hash, model_id, dimensions, languages, state, total, done, failed, created_at, ready_at) VALUES ('f49e0069-377f-49b8-826c-dfc2827abeed', '05a8e877-11fa-44ca-b2d4-e47cac8043bf', 'keyword', 'd90e2ab126408b52d5889476ddda30015cab5a3bc61e9a02dc9165085a10208b', NULL, NULL, '{german}', 'ready', 0, 2, 0, '2026-11-15 22:34:29.668704+00', '2026-11-15 22:34:29.725067+00');

INSERT INTO ont_upgrade_de.search_index (search_index_id, key, kind, entity_type_id, definition, created_at, updated_at) VALUES ('410e8e01-b3db-4272-938c-9a1dc09ae275', 'dokument~default', 'default', 'e4a8f6e1-b41b-4d64-8ea0-a1f6f984c263', '{"key": "dokument~default", "name": "Dokument — default", "fields": ["titel"], "header": [], "keyword": {"enabled": true}, "semantic": {"enabled": true, "template": null}, "relations": [], "entityType": "dokument", "description": "Finds Dokument entities by their own text properties: Titel."}', '2026-11-15 22:34:29.659177+00', '2026-11-15 22:34:29.659177+00');
INSERT INTO ont_upgrade_de.search_index (search_index_id, key, kind, entity_type_id, definition, created_at, updated_at) VALUES ('05a8e877-11fa-44ca-b2d4-e47cac8043bf', 'dokument~inhalt', 'passage', 'e4a8f6e1-b41b-4d64-8ea0-a1f6f984c263', '{"key": "dokument~inhalt", "name": "Dokument — Inhalt passages", "fields": ["inhalt"], "header": null, "keyword": {"enabled": true}, "semantic": {"enabled": true, "template": null}, "relations": [], "entityType": "dokument", "description": "Finds Dokument entities by passages of their Inhalt document; each passage starts with the entity''s name."}', '2026-11-15 22:34:29.660933+00', '2026-11-15 22:34:29.660933+00');
INSERT INTO ont_upgrade_de.search_index (search_index_id, key, kind, entity_type_id, definition, created_at, updated_at) VALUES ('20430653-b09e-4a98-ab91-40f4fd1159a8', 'ort~default', 'default', '7a8fab89-25b5-4682-813e-423078500a96', '{"key": "ort~default", "name": "Ort — default", "fields": ["bezeichnung"], "header": [], "keyword": {"enabled": true}, "semantic": {"enabled": true, "template": null}, "relations": [], "entityType": "ort", "description": "Finds Ort entities by their own text properties: Bezeichnung."}', '2026-11-15 22:34:29.662099+00', '2026-11-15 22:34:29.662099+00');

INSERT INTO ont_upgrade_de.search_settings (singleton, keyword_languages, disabled_defaults) VALUES (true, '{german}', '{}');

ALTER TABLE ONLY ont_upgrade.assistant_agent
    ADD CONSTRAINT assistant_agent_key_unique UNIQUE (lens_id, key);

ALTER TABLE ONLY ont_upgrade.assistant_agent
    ADD CONSTRAINT assistant_agent_pk PRIMARY KEY (assistant_agent_id);

ALTER TABLE ONLY ont_upgrade.assistant_navigator
    ADD CONSTRAINT assistant_navigator_key_unique UNIQUE (lens_id, key);

ALTER TABLE ONLY ont_upgrade.assistant_navigator
    ADD CONSTRAINT assistant_navigator_pk PRIMARY KEY (assistant_navigator_id);

ALTER TABLE ONLY ont_upgrade.assistant_retriever
    ADD CONSTRAINT assistant_retriever_key_unique UNIQUE (lens_id, key);

ALTER TABLE ONLY ont_upgrade.assistant_retriever
    ADD CONSTRAINT assistant_retriever_pk PRIMARY KEY (assistant_retriever_id);

ALTER TABLE ONLY ont_upgrade.changeset_object
    ADD CONSTRAINT changeset_object_pk PRIMARY KEY (changeset_id, object_id);

ALTER TABLE ONLY ont_upgrade.changeset
    ADD CONSTRAINT changeset_pk PRIMARY KEY (changeset_id);

ALTER TABLE ONLY ont_upgrade.changeset_value
    ADD CONSTRAINT changeset_value_pk PRIMARY KEY (changeset_id, object_id, property_key);

ALTER TABLE ONLY ont_upgrade.entity
    ADD CONSTRAINT entity_pk PRIMARY KEY (id);

ALTER TABLE ONLY ont_upgrade.entity_type
    ADD CONSTRAINT entity_type_key_unique UNIQUE (key);

ALTER TABLE ONLY ont_upgrade.entity_type
    ADD CONSTRAINT entity_type_pk PRIMARY KEY (entity_type_id);

ALTER TABLE ONLY ont_upgrade.lens_includes
    ADD CONSTRAINT lens_includes_entity_unique UNIQUE (lens_id, entity_type_id);

ALTER TABLE ONLY ont_upgrade.lens_includes
    ADD CONSTRAINT lens_includes_relation_unique UNIQUE (lens_id, relation_type_id);

ALTER TABLE ONLY ont_upgrade.lens_includes
    ADD CONSTRAINT lens_includes_search_index_unique UNIQUE (lens_id, search_index_id);

ALTER TABLE ONLY ont_upgrade.lens
    ADD CONSTRAINT lens_key_unique UNIQUE (key);

ALTER TABLE ONLY ont_upgrade.lens
    ADD CONSTRAINT lens_name_unique UNIQUE (name);

ALTER TABLE ONLY ont_upgrade.lens
    ADD CONSTRAINT lens_pk PRIMARY KEY (lens_id);

ALTER TABLE ONLY ont_upgrade.property_def
    ADD CONSTRAINT property_def_entity_key_unique UNIQUE (entity_type_id, key);

ALTER TABLE ONLY ont_upgrade.property_def
    ADD CONSTRAINT property_def_pk PRIMARY KEY (property_id);

ALTER TABLE ONLY ont_upgrade.property_def
    ADD CONSTRAINT property_def_relation_key_unique UNIQUE (relation_type_id, key);

ALTER TABLE ONLY ont_upgrade.relation
    ADD CONSTRAINT relation_pk PRIMARY KEY (id);

ALTER TABLE ONLY ont_upgrade.relation_type
    ADD CONSTRAINT relation_type_key_unique UNIQUE (key);

ALTER TABLE ONLY ont_upgrade.relation_type
    ADD CONSTRAINT relation_type_pk PRIMARY KEY (relation_type_id);

ALTER TABLE ONLY ont_upgrade.ruleset
    ADD CONSTRAINT ruleset_pk PRIMARY KEY (key);

ALTER TABLE ONLY ont_upgrade.saved_query
    ADD CONSTRAINT saved_query_key_unique UNIQUE (lens_id, key);

ALTER TABLE ONLY ont_upgrade.saved_query
    ADD CONSTRAINT saved_query_pk PRIMARY KEY (saved_query_id);

ALTER TABLE ONLY ont_upgrade.search_entry
    ADD CONSTRAINT search_entry_pk PRIMARY KEY (generation_id, entity_id, part_kind, group_no, part_id);

ALTER TABLE ONLY ont_upgrade.se_1b92cadc186a42b09bd6594ef250c956
    ADD CONSTRAINT se_1b92cadc186a42b09bd6594ef250c956_pk PRIMARY KEY (generation_id, entity_id, part_kind, group_no, part_id);

ALTER TABLE ONLY ont_upgrade.se_72c78607f8674206ae7dfe4d5027af5d
    ADD CONSTRAINT se_72c78607f8674206ae7dfe4d5027af5d_pk PRIMARY KEY (generation_id, entity_id, part_kind, group_no, part_id);

ALTER TABLE ONLY ont_upgrade.se_ae7ab2135ea04eecaa703032931d1b8a
    ADD CONSTRAINT se_ae7ab2135ea04eecaa703032931d1b8a_pk PRIMARY KEY (generation_id, entity_id, part_kind, group_no, part_id);

ALTER TABLE ONLY ont_upgrade.se_b7c84078512b44ddb5b47305e609ab3e
    ADD CONSTRAINT se_b7c84078512b44ddb5b47305e609ab3e_pk PRIMARY KEY (generation_id, entity_id, part_kind, group_no, part_id);

ALTER TABLE ONLY ont_upgrade.se_bea3032f44ae4261b0219b0dea62f993
    ADD CONSTRAINT se_bea3032f44ae4261b0219b0dea62f993_pk PRIMARY KEY (generation_id, entity_id, part_kind, group_no, part_id);

ALTER TABLE ONLY ont_upgrade.se_cb975937c31b40b3a06223fd6ddae84d
    ADD CONSTRAINT se_cb975937c31b40b3a06223fd6ddae84d_pk PRIMARY KEY (generation_id, entity_id, part_kind, group_no, part_id);

ALTER TABLE ONLY ont_upgrade.search_generation
    ADD CONSTRAINT search_generation_pk PRIMARY KEY (generation_id);

ALTER TABLE ONLY ont_upgrade.search_index
    ADD CONSTRAINT search_index_key_unique UNIQUE (key);

ALTER TABLE ONLY ont_upgrade.search_index
    ADD CONSTRAINT search_index_pk PRIMARY KEY (search_index_id);

ALTER TABLE ONLY ont_upgrade.search_queue
    ADD CONSTRAINT search_queue_pk PRIMARY KEY (generation_id, entity_id, part_kind, group_no, part_id);

ALTER TABLE ONLY ont_upgrade.search_settings
    ADD CONSTRAINT search_settings_pk PRIMARY KEY (singleton);

ALTER TABLE ONLY ont_upgrade_de.assistant_agent
    ADD CONSTRAINT assistant_agent_key_unique UNIQUE (lens_id, key);

ALTER TABLE ONLY ont_upgrade_de.assistant_agent
    ADD CONSTRAINT assistant_agent_pk PRIMARY KEY (assistant_agent_id);

ALTER TABLE ONLY ont_upgrade_de.assistant_navigator
    ADD CONSTRAINT assistant_navigator_key_unique UNIQUE (lens_id, key);

ALTER TABLE ONLY ont_upgrade_de.assistant_navigator
    ADD CONSTRAINT assistant_navigator_pk PRIMARY KEY (assistant_navigator_id);

ALTER TABLE ONLY ont_upgrade_de.assistant_retriever
    ADD CONSTRAINT assistant_retriever_key_unique UNIQUE (lens_id, key);

ALTER TABLE ONLY ont_upgrade_de.assistant_retriever
    ADD CONSTRAINT assistant_retriever_pk PRIMARY KEY (assistant_retriever_id);

ALTER TABLE ONLY ont_upgrade_de.changeset_object
    ADD CONSTRAINT changeset_object_pk PRIMARY KEY (changeset_id, object_id);

ALTER TABLE ONLY ont_upgrade_de.changeset
    ADD CONSTRAINT changeset_pk PRIMARY KEY (changeset_id);

ALTER TABLE ONLY ont_upgrade_de.changeset_value
    ADD CONSTRAINT changeset_value_pk PRIMARY KEY (changeset_id, object_id, property_key);

ALTER TABLE ONLY ont_upgrade_de.entity
    ADD CONSTRAINT entity_pk PRIMARY KEY (id);

ALTER TABLE ONLY ont_upgrade_de.entity_type
    ADD CONSTRAINT entity_type_key_unique UNIQUE (key);

ALTER TABLE ONLY ont_upgrade_de.entity_type
    ADD CONSTRAINT entity_type_pk PRIMARY KEY (entity_type_id);

ALTER TABLE ONLY ont_upgrade_de.lens_includes
    ADD CONSTRAINT lens_includes_entity_unique UNIQUE (lens_id, entity_type_id);

ALTER TABLE ONLY ont_upgrade_de.lens_includes
    ADD CONSTRAINT lens_includes_relation_unique UNIQUE (lens_id, relation_type_id);

ALTER TABLE ONLY ont_upgrade_de.lens_includes
    ADD CONSTRAINT lens_includes_search_index_unique UNIQUE (lens_id, search_index_id);

ALTER TABLE ONLY ont_upgrade_de.lens
    ADD CONSTRAINT lens_key_unique UNIQUE (key);

ALTER TABLE ONLY ont_upgrade_de.lens
    ADD CONSTRAINT lens_name_unique UNIQUE (name);

ALTER TABLE ONLY ont_upgrade_de.lens
    ADD CONSTRAINT lens_pk PRIMARY KEY (lens_id);

ALTER TABLE ONLY ont_upgrade_de.property_def
    ADD CONSTRAINT property_def_entity_key_unique UNIQUE (entity_type_id, key);

ALTER TABLE ONLY ont_upgrade_de.property_def
    ADD CONSTRAINT property_def_pk PRIMARY KEY (property_id);

ALTER TABLE ONLY ont_upgrade_de.property_def
    ADD CONSTRAINT property_def_relation_key_unique UNIQUE (relation_type_id, key);

ALTER TABLE ONLY ont_upgrade_de.relation
    ADD CONSTRAINT relation_pk PRIMARY KEY (id);

ALTER TABLE ONLY ont_upgrade_de.relation_type
    ADD CONSTRAINT relation_type_key_unique UNIQUE (key);

ALTER TABLE ONLY ont_upgrade_de.relation_type
    ADD CONSTRAINT relation_type_pk PRIMARY KEY (relation_type_id);

ALTER TABLE ONLY ont_upgrade_de.ruleset
    ADD CONSTRAINT ruleset_pk PRIMARY KEY (key);

ALTER TABLE ONLY ont_upgrade_de.saved_query
    ADD CONSTRAINT saved_query_key_unique UNIQUE (lens_id, key);

ALTER TABLE ONLY ont_upgrade_de.saved_query
    ADD CONSTRAINT saved_query_pk PRIMARY KEY (saved_query_id);

ALTER TABLE ONLY ont_upgrade_de.search_entry
    ADD CONSTRAINT search_entry_pk PRIMARY KEY (generation_id, entity_id, part_kind, group_no, part_id);

ALTER TABLE ONLY ont_upgrade_de.se_e0b5c8efb092440c8756fc1250d85f2a
    ADD CONSTRAINT se_e0b5c8efb092440c8756fc1250d85f2a_pk PRIMARY KEY (generation_id, entity_id, part_kind, group_no, part_id);

ALTER TABLE ONLY ont_upgrade_de.se_eb3523b85fc846cd943574d1224e335e
    ADD CONSTRAINT se_eb3523b85fc846cd943574d1224e335e_pk PRIMARY KEY (generation_id, entity_id, part_kind, group_no, part_id);

ALTER TABLE ONLY ont_upgrade_de.se_f49e0069377f49b8826cdfc2827abeed
    ADD CONSTRAINT se_f49e0069377f49b8826cdfc2827abeed_pk PRIMARY KEY (generation_id, entity_id, part_kind, group_no, part_id);

ALTER TABLE ONLY ont_upgrade_de.search_generation
    ADD CONSTRAINT search_generation_pk PRIMARY KEY (generation_id);

ALTER TABLE ONLY ont_upgrade_de.search_index
    ADD CONSTRAINT search_index_key_unique UNIQUE (key);

ALTER TABLE ONLY ont_upgrade_de.search_index
    ADD CONSTRAINT search_index_pk PRIMARY KEY (search_index_id);

ALTER TABLE ONLY ont_upgrade_de.search_queue
    ADD CONSTRAINT search_queue_pk PRIMARY KEY (generation_id, entity_id, part_kind, group_no, part_id);

ALTER TABLE ONLY ont_upgrade_de.search_settings
    ADD CONSTRAINT search_settings_pk PRIMARY KEY (singleton);

CREATE INDEX changeset_lens_id_idx ON ont_upgrade.changeset USING btree (lens_id);

CREATE INDEX changeset_object_touched_idx ON ont_upgrade.changeset_object USING btree (changeset_id, first_touched_at, object_id);

CREATE INDEX entity_type_key_idx ON ont_upgrade.entity USING btree (type_key);

CREATE INDEX relation_from_id_idx ON ont_upgrade.relation USING btree (from_id);

CREATE INDEX relation_to_id_idx ON ont_upgrade.relation USING btree (to_id);

CREATE INDEX relation_type_key_idx ON ont_upgrade.relation USING btree (type_key);

CREATE INDEX se_1b92cadc186a42b09bd6594ef250c956_entity ON ont_upgrade.se_1b92cadc186a42b09bd6594ef250c956 USING btree (entity_id);

CREATE INDEX se_1b92cadc186a42b09bd6594ef250c956_part ON ont_upgrade.se_1b92cadc186a42b09bd6594ef250c956 USING btree (part_id);

CREATE INDEX se_1b92cadc186a42b09bd6594ef250c956_tsv ON ont_upgrade.se_1b92cadc186a42b09bd6594ef250c956 USING gin (tsv);

CREATE INDEX se_72c78607f8674206ae7dfe4d5027af5d_entity ON ont_upgrade.se_72c78607f8674206ae7dfe4d5027af5d USING btree (entity_id);

CREATE INDEX se_72c78607f8674206ae7dfe4d5027af5d_part ON ont_upgrade.se_72c78607f8674206ae7dfe4d5027af5d USING btree (part_id);

CREATE INDEX se_72c78607f8674206ae7dfe4d5027af5d_tsv ON ont_upgrade.se_72c78607f8674206ae7dfe4d5027af5d USING gin (tsv);

CREATE INDEX se_ae7ab2135ea04eecaa703032931d1b8a_entity ON ont_upgrade.se_ae7ab2135ea04eecaa703032931d1b8a USING btree (entity_id);

CREATE INDEX se_ae7ab2135ea04eecaa703032931d1b8a_part ON ont_upgrade.se_ae7ab2135ea04eecaa703032931d1b8a USING btree (part_id);

CREATE INDEX se_ae7ab2135ea04eecaa703032931d1b8a_tsv ON ont_upgrade.se_ae7ab2135ea04eecaa703032931d1b8a USING gin (tsv);

CREATE INDEX se_b7c84078512b44ddb5b47305e609ab3e_entity ON ont_upgrade.se_b7c84078512b44ddb5b47305e609ab3e USING btree (entity_id);

CREATE INDEX se_b7c84078512b44ddb5b47305e609ab3e_part ON ont_upgrade.se_b7c84078512b44ddb5b47305e609ab3e USING btree (part_id);

CREATE INDEX se_b7c84078512b44ddb5b47305e609ab3e_tsv ON ont_upgrade.se_b7c84078512b44ddb5b47305e609ab3e USING gin (tsv);

CREATE INDEX se_bea3032f44ae4261b0219b0dea62f993_entity ON ont_upgrade.se_bea3032f44ae4261b0219b0dea62f993 USING btree (entity_id);

CREATE INDEX se_bea3032f44ae4261b0219b0dea62f993_part ON ont_upgrade.se_bea3032f44ae4261b0219b0dea62f993 USING btree (part_id);

CREATE INDEX se_bea3032f44ae4261b0219b0dea62f993_tsv ON ont_upgrade.se_bea3032f44ae4261b0219b0dea62f993 USING gin (tsv);

CREATE INDEX se_cb975937c31b40b3a06223fd6ddae84d_entity ON ont_upgrade.se_cb975937c31b40b3a06223fd6ddae84d USING btree (entity_id);

CREATE INDEX se_cb975937c31b40b3a06223fd6ddae84d_part ON ont_upgrade.se_cb975937c31b40b3a06223fd6ddae84d USING btree (part_id);

CREATE INDEX se_cb975937c31b40b3a06223fd6ddae84d_tsv ON ont_upgrade.se_cb975937c31b40b3a06223fd6ddae84d USING gin (tsv);

CREATE UNIQUE INDEX search_generation_building_unique ON ont_upgrade.search_generation USING btree (search_index_id, representation) WHERE (state = 'building'::text);

CREATE UNIQUE INDEX search_generation_ready_unique ON ont_upgrade.search_generation USING btree (search_index_id, representation) WHERE (state = 'ready'::text);

CREATE INDEX search_queue_due_idx ON ont_upgrade.search_queue USING btree (not_before);

CREATE INDEX search_queue_entity_idx ON ont_upgrade.search_queue USING btree (entity_id);

CREATE INDEX search_queue_part_idx ON ont_upgrade.search_queue USING btree (part_id);

CREATE INDEX changeset_lens_id_idx ON ont_upgrade_de.changeset USING btree (lens_id);

CREATE INDEX changeset_object_touched_idx ON ont_upgrade_de.changeset_object USING btree (changeset_id, first_touched_at, object_id);

CREATE INDEX entity_type_key_idx ON ont_upgrade_de.entity USING btree (type_key);

CREATE INDEX relation_from_id_idx ON ont_upgrade_de.relation USING btree (from_id);

CREATE INDEX relation_to_id_idx ON ont_upgrade_de.relation USING btree (to_id);

CREATE INDEX relation_type_key_idx ON ont_upgrade_de.relation USING btree (type_key);

CREATE INDEX se_e0b5c8efb092440c8756fc1250d85f2a_entity ON ont_upgrade_de.se_e0b5c8efb092440c8756fc1250d85f2a USING btree (entity_id);

CREATE INDEX se_e0b5c8efb092440c8756fc1250d85f2a_part ON ont_upgrade_de.se_e0b5c8efb092440c8756fc1250d85f2a USING btree (part_id);

CREATE INDEX se_e0b5c8efb092440c8756fc1250d85f2a_tsv ON ont_upgrade_de.se_e0b5c8efb092440c8756fc1250d85f2a USING gin (tsv);

CREATE INDEX se_eb3523b85fc846cd943574d1224e335e_entity ON ont_upgrade_de.se_eb3523b85fc846cd943574d1224e335e USING btree (entity_id);

CREATE INDEX se_eb3523b85fc846cd943574d1224e335e_part ON ont_upgrade_de.se_eb3523b85fc846cd943574d1224e335e USING btree (part_id);

CREATE INDEX se_eb3523b85fc846cd943574d1224e335e_tsv ON ont_upgrade_de.se_eb3523b85fc846cd943574d1224e335e USING gin (tsv);

CREATE INDEX se_f49e0069377f49b8826cdfc2827abeed_entity ON ont_upgrade_de.se_f49e0069377f49b8826cdfc2827abeed USING btree (entity_id);

CREATE INDEX se_f49e0069377f49b8826cdfc2827abeed_part ON ont_upgrade_de.se_f49e0069377f49b8826cdfc2827abeed USING btree (part_id);

CREATE INDEX se_f49e0069377f49b8826cdfc2827abeed_tsv ON ont_upgrade_de.se_f49e0069377f49b8826cdfc2827abeed USING gin (tsv);

CREATE UNIQUE INDEX search_generation_building_unique ON ont_upgrade_de.search_generation USING btree (search_index_id, representation) WHERE (state = 'building'::text);

CREATE UNIQUE INDEX search_generation_ready_unique ON ont_upgrade_de.search_generation USING btree (search_index_id, representation) WHERE (state = 'ready'::text);

CREATE INDEX search_queue_due_idx ON ont_upgrade_de.search_queue USING btree (not_before);

CREATE INDEX search_queue_entity_idx ON ont_upgrade_de.search_queue USING btree (entity_id);

CREATE INDEX search_queue_part_idx ON ont_upgrade_de.search_queue USING btree (part_id);

ALTER INDEX ont_upgrade.search_entry_pk ATTACH PARTITION ont_upgrade.se_1b92cadc186a42b09bd6594ef250c956_pk;

ALTER INDEX ont_upgrade.search_entry_pk ATTACH PARTITION ont_upgrade.se_72c78607f8674206ae7dfe4d5027af5d_pk;

ALTER INDEX ont_upgrade.search_entry_pk ATTACH PARTITION ont_upgrade.se_ae7ab2135ea04eecaa703032931d1b8a_pk;

ALTER INDEX ont_upgrade.search_entry_pk ATTACH PARTITION ont_upgrade.se_b7c84078512b44ddb5b47305e609ab3e_pk;

ALTER INDEX ont_upgrade.search_entry_pk ATTACH PARTITION ont_upgrade.se_bea3032f44ae4261b0219b0dea62f993_pk;

ALTER INDEX ont_upgrade.search_entry_pk ATTACH PARTITION ont_upgrade.se_cb975937c31b40b3a06223fd6ddae84d_pk;

ALTER INDEX ont_upgrade_de.search_entry_pk ATTACH PARTITION ont_upgrade_de.se_e0b5c8efb092440c8756fc1250d85f2a_pk;

ALTER INDEX ont_upgrade_de.search_entry_pk ATTACH PARTITION ont_upgrade_de.se_eb3523b85fc846cd943574d1224e335e_pk;

ALTER INDEX ont_upgrade_de.search_entry_pk ATTACH PARTITION ont_upgrade_de.se_f49e0069377f49b8826cdfc2827abeed_pk;

ALTER TABLE ONLY ont_upgrade.assistant_agent
    ADD CONSTRAINT assistant_agent_lens_fk FOREIGN KEY (lens_id) REFERENCES ont_upgrade.lens(lens_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade.assistant_navigator
    ADD CONSTRAINT assistant_navigator_lens_fk FOREIGN KEY (lens_id) REFERENCES ont_upgrade.lens(lens_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade.assistant_retriever
    ADD CONSTRAINT assistant_retriever_lens_fk FOREIGN KEY (lens_id) REFERENCES ont_upgrade.lens(lens_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade.changeset
    ADD CONSTRAINT changeset_lens_fk FOREIGN KEY (lens_id) REFERENCES ont_upgrade.lens(lens_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade.changeset_object
    ADD CONSTRAINT changeset_object_changeset_fk FOREIGN KEY (changeset_id) REFERENCES ont_upgrade.changeset(changeset_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade.changeset_value
    ADD CONSTRAINT changeset_value_object_fk FOREIGN KEY (changeset_id, object_id) REFERENCES ont_upgrade.changeset_object(changeset_id, object_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade.entity_type
    ADD CONSTRAINT entity_type_name_property_fk FOREIGN KEY (entity_type_id, name_property) REFERENCES ont_upgrade.property_def(entity_type_id, key) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY ont_upgrade.lens_includes
    ADD CONSTRAINT lens_includes_entity_type_fk FOREIGN KEY (entity_type_id) REFERENCES ont_upgrade.entity_type(entity_type_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade.lens_includes
    ADD CONSTRAINT lens_includes_lens_fk FOREIGN KEY (lens_id) REFERENCES ont_upgrade.lens(lens_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade.lens_includes
    ADD CONSTRAINT lens_includes_relation_type_fk FOREIGN KEY (relation_type_id) REFERENCES ont_upgrade.relation_type(relation_type_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade.lens_includes
    ADD CONSTRAINT lens_includes_search_index_fk FOREIGN KEY (search_index_id) REFERENCES ont_upgrade.search_index(search_index_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade.property_def
    ADD CONSTRAINT property_def_entity_type_fk FOREIGN KEY (entity_type_id) REFERENCES ont_upgrade.entity_type(entity_type_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade.property_def
    ADD CONSTRAINT property_def_relation_type_fk FOREIGN KEY (relation_type_id) REFERENCES ont_upgrade.relation_type(relation_type_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade.relation
    ADD CONSTRAINT relation_from_fk FOREIGN KEY (from_id) REFERENCES ont_upgrade.entity(id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade.relation
    ADD CONSTRAINT relation_to_fk FOREIGN KEY (to_id) REFERENCES ont_upgrade.entity(id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade.relation_type
    ADD CONSTRAINT relation_type_source_fk FOREIGN KEY (source_entity_type_key) REFERENCES ont_upgrade.entity_type(key) ON DELETE RESTRICT;

ALTER TABLE ONLY ont_upgrade.relation_type
    ADD CONSTRAINT relation_type_target_fk FOREIGN KEY (target_entity_type_key) REFERENCES ont_upgrade.entity_type(key) ON DELETE RESTRICT;

ALTER TABLE ONLY ont_upgrade.saved_query
    ADD CONSTRAINT saved_query_lens_fk FOREIGN KEY (lens_id) REFERENCES ont_upgrade.lens(lens_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade.search_generation
    ADD CONSTRAINT search_generation_search_index_fk FOREIGN KEY (search_index_id) REFERENCES ont_upgrade.search_index(search_index_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade.search_index
    ADD CONSTRAINT search_index_entity_type_fk FOREIGN KEY (entity_type_id) REFERENCES ont_upgrade.entity_type(entity_type_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade.search_queue
    ADD CONSTRAINT search_queue_generation_fk FOREIGN KEY (generation_id) REFERENCES ont_upgrade.search_generation(generation_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade_de.assistant_agent
    ADD CONSTRAINT assistant_agent_lens_fk FOREIGN KEY (lens_id) REFERENCES ont_upgrade_de.lens(lens_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade_de.assistant_navigator
    ADD CONSTRAINT assistant_navigator_lens_fk FOREIGN KEY (lens_id) REFERENCES ont_upgrade_de.lens(lens_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade_de.assistant_retriever
    ADD CONSTRAINT assistant_retriever_lens_fk FOREIGN KEY (lens_id) REFERENCES ont_upgrade_de.lens(lens_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade_de.changeset
    ADD CONSTRAINT changeset_lens_fk FOREIGN KEY (lens_id) REFERENCES ont_upgrade_de.lens(lens_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade_de.changeset_object
    ADD CONSTRAINT changeset_object_changeset_fk FOREIGN KEY (changeset_id) REFERENCES ont_upgrade_de.changeset(changeset_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade_de.changeset_value
    ADD CONSTRAINT changeset_value_object_fk FOREIGN KEY (changeset_id, object_id) REFERENCES ont_upgrade_de.changeset_object(changeset_id, object_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade_de.entity_type
    ADD CONSTRAINT entity_type_name_property_fk FOREIGN KEY (entity_type_id, name_property) REFERENCES ont_upgrade_de.property_def(entity_type_id, key) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY ont_upgrade_de.lens_includes
    ADD CONSTRAINT lens_includes_entity_type_fk FOREIGN KEY (entity_type_id) REFERENCES ont_upgrade_de.entity_type(entity_type_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade_de.lens_includes
    ADD CONSTRAINT lens_includes_lens_fk FOREIGN KEY (lens_id) REFERENCES ont_upgrade_de.lens(lens_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade_de.lens_includes
    ADD CONSTRAINT lens_includes_relation_type_fk FOREIGN KEY (relation_type_id) REFERENCES ont_upgrade_de.relation_type(relation_type_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade_de.lens_includes
    ADD CONSTRAINT lens_includes_search_index_fk FOREIGN KEY (search_index_id) REFERENCES ont_upgrade_de.search_index(search_index_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade_de.property_def
    ADD CONSTRAINT property_def_entity_type_fk FOREIGN KEY (entity_type_id) REFERENCES ont_upgrade_de.entity_type(entity_type_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade_de.property_def
    ADD CONSTRAINT property_def_relation_type_fk FOREIGN KEY (relation_type_id) REFERENCES ont_upgrade_de.relation_type(relation_type_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade_de.relation
    ADD CONSTRAINT relation_from_fk FOREIGN KEY (from_id) REFERENCES ont_upgrade_de.entity(id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade_de.relation
    ADD CONSTRAINT relation_to_fk FOREIGN KEY (to_id) REFERENCES ont_upgrade_de.entity(id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade_de.relation_type
    ADD CONSTRAINT relation_type_source_fk FOREIGN KEY (source_entity_type_key) REFERENCES ont_upgrade_de.entity_type(key) ON DELETE RESTRICT;

ALTER TABLE ONLY ont_upgrade_de.relation_type
    ADD CONSTRAINT relation_type_target_fk FOREIGN KEY (target_entity_type_key) REFERENCES ont_upgrade_de.entity_type(key) ON DELETE RESTRICT;

ALTER TABLE ONLY ont_upgrade_de.saved_query
    ADD CONSTRAINT saved_query_lens_fk FOREIGN KEY (lens_id) REFERENCES ont_upgrade_de.lens(lens_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade_de.search_generation
    ADD CONSTRAINT search_generation_search_index_fk FOREIGN KEY (search_index_id) REFERENCES ont_upgrade_de.search_index(search_index_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade_de.search_index
    ADD CONSTRAINT search_index_entity_type_fk FOREIGN KEY (entity_type_id) REFERENCES ont_upgrade_de.entity_type(entity_type_id) ON DELETE CASCADE;

ALTER TABLE ONLY ont_upgrade_de.search_queue
    ADD CONSTRAINT search_queue_generation_fk FOREIGN KEY (generation_id) REFERENCES ont_upgrade_de.search_generation(generation_id) ON DELETE CASCADE;
