"""Long-term memory: saved profiles, one row per version per company."""

import json
import re

from psycopg import errors
from psycopg_pool import AsyncConnectionPool


def company_key(name: str) -> str:
    """How runs for the same company find each other: "  Stripe  Inc" -> "stripe inc"."""
    return re.sub(r"\s+", " ", name).strip().lower()


class ProfileStore:
    def __init__(self, pool: AsyncConnectionPool):
        self.pool = pool

    async def latest(self, key: str) -> dict | None:
        """The newest saved version: {"version", "run_id", "profile"}, or None."""
        async with self.pool.connection() as conn:
            row = await (
                await conn.execute(
                    """select version, run_id::text, profile from profiles
                       where company_key = %s order by version desc limit 1""",
                    (key,),
                )
            ).fetchone()
        return dict(row) if row else None

    async def save(self, run_id: str, key: str, profile: dict) -> int:
        """Stores the profile as the company's next version; returns its number.

        Idempotent per run: a save node that runs again after a resume gets
        the version the first attempt stored."""
        async with self.pool.connection() as conn:
            for _ in range(3):
                try:
                    row = await (
                        await conn.execute(
                            """insert into profiles (company_key, version, run_id, profile)
                               select %(key)s, coalesce(max(version), 0) + 1, %(run_id)s, %(profile)s
                               from profiles where company_key = %(key)s
                               on conflict (run_id) do nothing
                               returning version""",
                            {"key": key, "run_id": run_id, "profile": json.dumps(profile)},
                        )
                    ).fetchone()
                except errors.UniqueViolation:
                    # Another run for this company took the same version
                    # number first; count again.
                    continue
                if row is None:
                    row = await (
                        await conn.execute("select version from profiles where run_id = %s", (run_id,))
                    ).fetchone()
                return row["version"]
        raise RuntimeError(f"could not store a profile version for {key!r}")
