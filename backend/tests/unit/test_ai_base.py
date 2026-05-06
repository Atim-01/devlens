"""
Unit tests for app/ai/base.py

Tests cover:
  - AnalysisResult dataclass construction and defaults
  - BaseAnalyser cannot be instantiated directly (it's abstract)
  - A concrete subclass that implements analyse() works correctly
"""

import pytest

from app.ai.base import DIMENSIONS, SEVERITY_LEVELS, AnalysisResult, BaseAnalyser

# ─── AnalysisResult ───────────────────────────────────────────────────────────


def test_analysis_result_stores_scores_and_issues():
    """AnalysisResult holds the values passed to it."""
    scores = {"security": 80, "performance": 70}
    issues = [{"title": "SQL injection", "severity": "critical"}]

    result = AnalysisResult(scores=scores, issues=issues, engine="huggingface")

    assert result.scores == scores
    assert result.issues == issues
    assert result.engine == "huggingface"


def test_analysis_result_degraded_defaults_to_false():
    """degraded is False by default — only True when local fallback ran."""
    result = AnalysisResult(scores={}, issues=[], engine="huggingface")
    assert result.degraded is False


def test_analysis_result_degraded_can_be_set_true():
    """degraded=True marks a result from the local fallback engine."""
    result = AnalysisResult(scores={}, issues=[], engine="local", degraded=True)
    assert result.degraded is True


def test_analysis_result_engine_huggingface():
    """engine field records which analyser produced the result."""
    result = AnalysisResult(scores={}, issues=[], engine="huggingface")
    assert result.engine == "huggingface"


def test_analysis_result_engine_local():
    """Local engine results carry engine='local'."""
    result = AnalysisResult(scores={}, issues=[], engine="local", degraded=True)
    assert result.engine == "local"


# ─── DIMENSIONS and SEVERITY_LEVELS constants ─────────────────────────────────


def test_dimensions_contains_all_five():
    """All five scoring dimensions are defined."""
    assert set(DIMENSIONS) == {
        "security",
        "performance",
        "readability",
        "complexity",
        "bug_risk",
    }


def test_severity_levels_contains_all_three():
    """All three severity levels are defined."""
    assert set(SEVERITY_LEVELS) == {"critical", "warning", "info"}


# ─── BaseAnalyser ─────────────────────────────────────────────────────────────


def test_base_analyser_cannot_be_instantiated_directly():
    """
    BaseAnalyser is abstract — instantiating it directly raises TypeError.
    This ensures every analyser must implement analyse().
    """
    with pytest.raises(TypeError):
        BaseAnalyser()


def test_concrete_subclass_without_analyse_cannot_be_instantiated():
    """A subclass that forgets to implement analyse() also raises TypeError."""

    class IncompleteAnalyser(BaseAnalyser):
        pass  # forgot to implement analyse()

    with pytest.raises(TypeError):
        IncompleteAnalyser()


def test_concrete_subclass_with_analyse_works():
    """
    A subclass that implements analyse() can be instantiated and called.
    This is the pattern every real analyser follows.
    """

    class DummyAnalyser(BaseAnalyser):
        def analyse(self, files: list[dict]) -> AnalysisResult:
            return AnalysisResult(
                scores={"security": 100},
                issues=[],
                engine="dummy",
            )

    analyser = DummyAnalyser()
    result = analyser.analyse([{"path": "main.py", "content": "print('hello')"}])

    assert isinstance(result, AnalysisResult)
    assert result.engine == "dummy"
    assert result.scores["security"] == 100
    assert result.issues == []


def test_analyse_receives_files_list():
    """analyse() receives a list of file dicts with path and content keys."""
    received_files = []

    class CapturingAnalyser(BaseAnalyser):
        def analyse(self, files: list[dict]) -> AnalysisResult:
            received_files.extend(files)
            return AnalysisResult(scores={}, issues=[], engine="capturing")

    analyser = CapturingAnalyser()
    files = [
        {"path": "auth.py", "content": "SELECT * FROM users"},
        {"path": "utils.py", "content": "def helper(): pass"},
    ]
    analyser.analyse(files)

    assert len(received_files) == 2
    assert received_files[0]["path"] == "auth.py"
    assert received_files[1]["path"] == "utils.py"
