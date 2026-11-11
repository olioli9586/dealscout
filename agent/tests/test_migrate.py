import shutil

import psycopg
import pytest

from app.migrate import MIGRATIONS_DIR, migrate


async def test_a_second_run_applies_nothing(db_url):
    assert await migrate(db_url) == []


def test_the_checkpointer_tables_exist(db_url):
    with psycopg.connect(db_url) as conn:
        tables = {r[0] for r in conn.execute("select tablename from pg_tables where schemaname = 'public'")}
    assert {"runs", "profiles", "schema_migrations", "checkpoints", "checkpoint_writes"} <= tables


async def test_an_edited_migration_is_refused(db_url, tmp_path):
    shutil.copytree(MIGRATIONS_DIR, tmp_path, dirs_exist_ok=True)
    first = sorted(tmp_path.glob("*.sql"))[0]
    first.write_text(first.read_text() + "\n-- edited\n")
    with pytest.raises(RuntimeError, match="changed after it was applied"):
        await migrate(db_url, tmp_path)


async def test_a_new_file_is_applied_once(db_url, tmp_path):
    shutil.copytree(MIGRATIONS_DIR, tmp_path, dirs_exist_ok=True)
    (tmp_path / "999_probe.sql").write_text("create table migrate_probe (id int);")
    try:
        assert await migrate(db_url, tmp_path) == ["999_probe.sql"]
        assert await migrate(db_url, tmp_path) == []
    finally:
        with psycopg.connect(db_url, autocommit=True) as conn:
            conn.execute("drop table if exists migrate_probe")
            conn.execute("delete from schema_migrations where name = '999_probe.sql'")


async def test_a_failing_file_is_rolled_back(db_url, tmp_path):
    shutil.copytree(MIGRATIONS_DIR, tmp_path, dirs_exist_ok=True)
    (tmp_path / "999_broken.sql").write_text("create table half_done (id int); select 1/0;")
    with pytest.raises(psycopg.errors.DivisionByZero):
        await migrate(db_url, tmp_path)
    with psycopg.connect(db_url) as conn:
        assert conn.execute("select to_regclass('half_done')").fetchone()[0] is None
        recorded = conn.execute("select count(*) from schema_migrations where name = '999_broken.sql'")
        assert recorded.fetchone()[0] == 0
