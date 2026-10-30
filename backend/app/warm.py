"""Pre-fill the permanent cache with every settled session's data.

Run from the backend directory:

    .venv/bin/python -m app.warm                     # 2023 through this year
    .venv/bin/python -m app.warm --years 2025 2026

Safe to stop and start again at any point. Anything already on disk is a cache
hit and costs no request, so a rerun picks up where the previous one stopped.

Telemetry is deliberately not pre-filled: it is fetched one lap at a time, and
there are far too many laps to download speculatively. It is cached
permanently the first time anyone asks for a lap.

The run shares OpenF1's rate limit with any server running on the same
network address, so expect it to slow down while the app is also in use.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import time
from datetime import datetime, timezone

from .config import get_settings
from .providers.base import ProviderError
from .providers.openf1 import OpenF1Provider

log = logging.getLogger("delta.warm")

# Everything a session page reads except per-lap telemetry.
ENDPOINTS = (
    "drivers",
    "laps",
    "stints",
    "pit_stops",
    "race_control",
    "weather",
    "intervals",
    "positions",
    "team_radio",
)


async def warm(years: list[int]) -> int:
    """Fetch every endpoint for every settled session. Returns the failure count."""
    settings = get_settings()
    provider = OpenF1Provider(settings)
    started = time.monotonic()
    failures = 0
    try:
        for year in years:
            meetings = await provider.meetings(year)
            sessions = await provider.sessions(year=year)
            # The weekend picker lists sessions per meeting, a different query.
            for meeting in meetings:
                await provider.sessions(meeting_key=meeting.meeting_key)

            final = [s for s in sessions if provider.policy(s) == "permanent"]
            log.info(
                "%d: %d of %d sessions are final and will be cached",
                year, len(final), len(sessions),
            )

            for index, session in enumerate(final, start=1):
                before = provider.upstream_requests
                for name in ENDPOINTS:
                    try:
                        await getattr(provider, name)(session.session_key)
                    except ProviderError as exc:
                        failures += 1
                        log.warning("  %s %s failed: %s", session.session_key, name, exc)
                made = provider.upstream_requests - before
                log.info(
                    "%d [%d/%d] %s %s — %s",
                    year,
                    index,
                    len(final),
                    session.location or session.circuit_short_name or session.session_key,
                    session.session_name,
                    f"{made} request(s)" if made else "already cached",
                )
    finally:
        stats = provider.cache_stats()
        await provider.aclose()
        log.info(
            "Done in %.0f min: %d upstream request(s), %d failure(s). Cache: %d files, %.1f MB at %s",
            (time.monotonic() - started) / 60,
            provider.upstream_requests,
            failures,
            stats["disk_entries"],
            int(stats["disk_bytes"]) / 1e6,
            stats["directory"],
        )
    return failures


def main() -> None:
    first = 2023
    this_year = datetime.now(timezone.utc).year
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--years",
        type=int,
        nargs="+",
        default=list(range(first, this_year + 1)),
        help=f"seasons to cache (default: {first}-{this_year})",
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    # One line per HTTP request buries the per-session progress lines.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    failures = asyncio.run(warm(args.years))
    if failures:
        log.info("Rerun the same command to retry the %d failed request(s).", failures)


if __name__ == "__main__":
    main()
