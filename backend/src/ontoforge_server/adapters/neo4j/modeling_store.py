"""Neo4j implementation of the modeling store (schema persistence)."""

from neo4j import AsyncDriver


class Neo4jModelingStore:
    def __init__(self, driver: AsyncDriver):
        self._driver = driver
