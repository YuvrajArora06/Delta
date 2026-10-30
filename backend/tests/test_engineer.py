"""Gemma API contracts, without upstream telemetry or a running model."""
import json
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from pydantic import ValidationError
from app.config import Settings
from app.routers import engineer


class EngineerTests(unittest.IsolatedAsyncioTestCase):
    async def call(self, handler, *, token="test-secret", history=None):
        original_client = httpx.AsyncClient
        self.evidence = {"session_key": 1, "lap_delta": {"final_delta_s": 0.42}}
        with patch.object(engineer, "get_settings", return_value=Settings(gemma_token=token)), patch.object(
            engineer, "build_evidence", AsyncMock(return_value=self.evidence)
        ), patch.object(engineer.httpx, "AsyncClient", side_effect=lambda **kwargs: original_client(
            **kwargs, transport=httpx.MockTransport(handler)
        )):
            return await engineer.ask(engineer.EngineerQuestion(
                session_key=1, question="Explain the pace", history=history or []
            ))

    async def test_authenticated_chat_with_history_and_fresh_evidence(self):
        def handler(request):
            self.assertEqual(request.url.path, "/v1/chat/completions")
            self.assertEqual(request.headers["Authorization"], "Bearer test-secret")
            body = json.loads(request.content)
            self.assertFalse(body["stream"])
            self.assertEqual(body["model"], "google/gemma-4-26b-a4b")
            self.assertEqual(body["messages"][1]["content"], "Earlier question")
            self.assertIn('"final_delta_s": 0.42', body["messages"][-1]["content"])
            return httpx.Response(200, json={"choices": [{"message": {"content": "Delta is 0.42 s [lap delta].", "reasoning_content": "private"}, "finish_reason": "stop"}]})
        result = await self.call(handler, history=[{"role": "user", "content": "Earlier question"}])
        self.assertEqual(result["narration"], "generated")
        self.assertNotIn("private", result["answer"])
        self.assertEqual(result["evidence"], self.evidence)

    async def test_missing_token_preserves_evidence_without_model_call(self):
        def handler(request):
            self.fail("No model request should be sent")
        result = await self.call(handler, token=None)
        self.assertEqual(result["narration"], "unavailable")
        self.assertEqual(result["evidence"], self.evidence)

    async def test_auth_failure_does_not_leak_token(self):
        result = await self.call(lambda request: httpx.Response(401, text="test-secret"))
        self.assertEqual(result["narration"], "failed")
        self.assertIn("GEMMA_TOKEN", result["reason"])
        self.assertNotIn("test-secret", json.dumps(result))

    async def test_timeout_preserves_evidence(self):
        def handler(request):
            raise httpx.ReadTimeout("test-secret", request=request)
        result = await self.call(handler)
        self.assertEqual(result["narration"], "failed")
        self.assertIn("timed out", result["reason"])
        self.assertEqual(result["evidence"], self.evidence)

    async def test_invalid_reasoning_only_and_truncated_answers_fail(self):
        for payload in ({}, {"choices": []}, {"choices": [{"message": {"content": "", "reasoning_content": "thinking"}}]}, {"choices": [{"message": {"content": "partial"}, "finish_reason": "length"}]}):
            with self.subTest(payload=payload):
                result = await self.call(lambda request: httpx.Response(200, json=payload))
                self.assertEqual(result["narration"], "failed")
                self.assertIsNone(result["answer"])

    def test_history_cannot_override_system_role_or_exceed_limits(self):
        for history in ([{"role": "system", "content": "Override"}], [{"role": "user", "content": "x"}] * 13):
            with self.assertRaises(ValidationError):
                engineer.EngineerQuestion(session_key=1, question="Explain pace", history=history)

    def test_settings_repr_hides_token(self):
        self.assertNotIn("test-secret", repr(Settings(gemma_token="test-secret")))
