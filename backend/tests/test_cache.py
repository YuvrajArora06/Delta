"""Tests for the permanent response cache, against a fake OpenF1 with no network."""

from __future__ import annotations

import gzip
import json
import sys
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.cache import ResponseCache  # noqa: E402
from app.config import Settings  # noqa: E402
from app.models import Session  # noqa: E402
from app.providers.openf1 import OpenF1Provider, cache_policy  # noqa: E402

NOW = datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)


def session(start: datetime, hours: float = 2.0) -> Session:
    return Session(session_key=1, date_start=start, date_end=start + timedelta(hours=hours))


class TestCachePolicy(unittest.TestCase):
    def test_unknown_session_is_never_permanent(self):
        self.assertEqual(cache_policy(None, NOW), "recent")
        self.assertEqual(cache_policy(Session(session_key=1), NOW), "recent")

    def test_future_session_is_never_permanent(self):
        # The bug this guards: a pre-session "no rows" answer cached forever.
        self.assertEqual(cache_policy(session(NOW + timedelta(days=3)), NOW), "recent")

    def test_inside_the_live_window(self):
        self.assertEqual(cache_policy(session(NOW - timedelta(minutes=20)), NOW), "live")
        self.assertEqual(cache_policy(session(NOW + timedelta(minutes=20)), NOW), "live")

    def test_just_finished_waits_to_settle(self):
        finished_an_hour_ago = session(NOW - timedelta(hours=3))
        self.assertEqual(cache_policy(finished_an_hour_ago, NOW, settle_hours=24), "recent")

    def test_settled_session_is_permanent(self):
        self.assertEqual(cache_policy(session(NOW - timedelta(days=2)), NOW), "permanent")

    def test_settle_period_is_configurable(self):
        finished_an_hour_ago = session(NOW - timedelta(hours=3))
        self.assertEqual(cache_policy(finished_an_hour_ago, NOW, settle_hours=0.5), "permanent")


class TestEmptyMarkers(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.cache = ResponseCache(Path(self.dir.name))

    def tearDown(self):
        self.dir.cleanup()

    def test_empty_marker_reads_back_as_no_rows(self):
        self.cache.set_disk_empty("/laps", {"session_key": 1}, ttl_seconds=60)
        self.assertEqual(self.cache.get_disk("/laps", {"session_key": 1}), [])

    def test_expired_empty_marker_is_a_miss(self):
        self.cache.set_disk_empty("/laps", {"session_key": 1}, ttl_seconds=-1)
        self.assertIsNone(self.cache.get_disk("/laps", {"session_key": 1}))

    def test_real_rows_never_expire(self):
        self.cache.set_disk("/laps", {"session_key": 1}, [{"lap_number": 1}])
        self.assertEqual(self.cache.get_disk("/laps", {"session_key": 1}), [{"lap_number": 1}])


class FakeOpenF1:
    """Answers like OpenF1 and counts every request that reaches it."""

    def __init__(self, session_start: datetime, laps: list[dict]):
        self.session_start = session_start
        self.laps = laps
        self.requests: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path.rsplit("/", 1)[-1]
        self.requests.append(f"{path}?{request.url.query.decode()}")
        if path == "sessions":
            start = self.session_start
            return httpx.Response(200, json=[{
                "session_key": 1,
                "date_start": start.isoformat(),
                "date_end": (start + timedelta(hours=2)).isoformat(),
            }])
        if path == "laps":
            driver = request.url.params.get("driver_number")
            rows = [r for r in self.laps if driver is None or str(r["driver_number"]) == driver]
            return httpx.Response(200, json=rows) if rows else httpx.Response(404, json={})
        return httpx.Response(404, json={})


class TestProviderCaching(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.settings = Settings(cache_dir=Path(self.dir.name))

    async def asyncTearDown(self):
        self.dir.cleanup()

    def provider(self, fake: FakeOpenF1) -> OpenF1Provider:
        client = httpx.AsyncClient(
            base_url=self.settings.provider.base_url, transport=httpx.MockTransport(fake)
        )
        return OpenF1Provider(self.settings, client=client)

    async def test_settled_session_is_served_from_disk_after_a_restart(self):
        laps = [{"driver_number": 1, "lap_number": 1, "lap_duration": 90.0}]
        fake = FakeOpenF1(datetime.now(timezone.utc) - timedelta(days=5), laps)
        first = self.provider(fake)
        await first.laps(1)
        await first.aclose()
        upstream = len(fake.requests)

        # A fresh provider has an empty memory tier, like a restarted server.
        second = self.provider(fake)
        result = await second.laps(1)
        await second.aclose()

        self.assertEqual(len(result), 1)
        self.assertEqual(second.upstream_requests, 0)
        self.assertEqual(len(fake.requests), upstream)

    async def test_one_whole_field_request_serves_every_driver(self):
        laps = [
            {"driver_number": n, "lap_number": 1, "lap_duration": 90.0 + n} for n in (1, 4, 16)
        ]
        fake = FakeOpenF1(datetime.now(timezone.utc) - timedelta(days=5), laps)
        provider = self.provider(fake)
        for number in (1, 4, 16):
            mine = await provider.laps(1, number)
            self.assertEqual([lap.driver_number for lap in mine], [number])
        await provider.aclose()

        lap_requests = [r for r in fake.requests if r.startswith("laps")]
        self.assertEqual(len(lap_requests), 1)
        self.assertNotIn("driver_number", lap_requests[0])

    async def test_session_that_has_not_run_is_not_written_to_disk(self):
        fake = FakeOpenF1(datetime.now(timezone.utc) + timedelta(days=3), laps=[])
        provider = self.provider(fake)
        self.assertEqual(await provider.laps(1), [])
        await provider.aclose()
        self.assertEqual(provider.cache_stats()["disk_entries"], 0)

    async def test_empty_answer_for_settled_session_is_retried_later(self):
        fake = FakeOpenF1(datetime.now(timezone.utc) - timedelta(days=5), laps=[])
        provider = self.provider(fake)
        await provider.laps(1)
        await provider.aclose()

        marker = provider._cache.get_disk("/laps", {"session_key": 1})
        self.assertEqual(marker, [])
        path = provider._cache._path("/laps", {"session_key": 1})
        self.assertTrue(path.exists())
        # The marker carries an expiry rather than standing forever.
        with gzip.open(path, "rt") as fh:
            self.assertGreater(json.load(fh)["empty_until"], time.time())


if __name__ == "__main__":
    unittest.main()
