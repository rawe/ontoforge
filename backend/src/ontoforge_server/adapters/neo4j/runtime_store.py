"""Neo4j implementation of the runtime store (instance persistence)."""

from neo4j import AsyncDriver


class Neo4jRuntimeStore:
    def __init__(self, driver: AsyncDriver):
        self._driver = driver
