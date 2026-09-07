"""The field-mapping language is what makes a bespoke source configuration rather than code,
so it needs to behave predictably on the messy shapes real payloads actually have."""

from __future__ import annotations

import pytest

from crawler.normalization.fieldmap import (
    FieldMapError,
    apply_spec,
    map_record,
    resolve_path,
)

AMAZON = {
    "id_icims": "10424837",
    "title": "Software Development Engineer",
    "location": "IN, KA, Bengaluru",
    "job_path": "/en/jobs/10424837/sde",
    "posted_date": "May 20, 2026",
    "team": {"label": "Retail"},
}

DESHAW = {
    "id": "2781",
    "displayName": "Software Developer",
    "office": [
        {"abbreviation": "HYD", "name": "Hyderabad"},
        {"abbreviation": "BLR", "name": "Bengaluru"},
    ],
    "data": {"jobUrl": "/careers/jobs/2781", "jobDescription": "Build things."},
}


class TestResolvePath:
    def test_reads_a_top_level_key(self):
        assert resolve_path(AMAZON, "title") == "Software Development Engineer"

    def test_walks_nested_objects(self):
        assert resolve_path(AMAZON, "team.label") == "Retail"

    def test_indexes_into_lists(self):
        assert resolve_path(DESHAW, "office.0.name") == "Hyderabad"

    # A missing optional field is ordinary; the required-field check belongs at the
    # NormalizedJob boundary, where the error message can be useful.
    @pytest.mark.parametrize("path", ["nope", "team.nope", "team.label.deeper", "office.9.name"])
    def test_returns_none_for_anything_absent(self, path):
        assert resolve_path(AMAZON if "team" in path else DESHAW, path) is None

    def test_handles_none_midway_without_raising(self):
        assert resolve_path({"a": None}, "a.b.c") is None


class TestApplySpec:
    def test_string_spec_is_a_path(self):
        assert apply_spec(AMAZON, "title") == "Software Development Engineer"

    def test_template_interpolates_paths(self):
        spec = {"template": "https://www.amazon.jobs{job_path}"}
        assert apply_spec(AMAZON, spec) == "https://www.amazon.jobs/en/jobs/10424837/sde"

    def test_template_with_several_tokens(self):
        spec = {"template": "{title} — {location}"}
        assert apply_spec(AMAZON, spec) == "Software Development Engineer — IN, KA, Bengaluru"

    # A template whose tokens all resolve to nothing yields a string that looks valid and points
    # somewhere wrong -- "https://www.amazon.jobs" is worse than no URL at all.
    def test_template_returns_none_when_nothing_resolved(self):
        assert apply_spec(AMAZON, {"template": "https://x.com{missing}"}) is None

    def test_template_with_no_tokens_is_a_constant(self):
        assert apply_spec(AMAZON, {"template": "https://x.com"}) is None

    def test_pluck_and_join_collapse_a_list_of_objects(self):
        spec = {"path": "office", "pluck": "name", "join": ", "}
        assert apply_spec(DESHAW, spec) == "Hyderabad, Bengaluru"

    def test_pluck_on_a_single_object(self):
        assert apply_spec(AMAZON, {"path": "team", "pluck": "label"}) == "Retail"

    def test_join_without_pluck_joins_scalars(self):
        data = {"tags": ["go", "python"]}
        assert apply_spec(data, {"path": "tags", "join": " / "}) == "go / python"

    def test_default_fills_an_absent_value(self):
        assert apply_spec(AMAZON, {"path": "nope", "default": "Unknown"}) == "Unknown"

    def test_default_fills_an_empty_value(self):
        assert apply_spec({"x": ""}, {"path": "x", "default": "fallback"}) == "fallback"

    def test_default_does_not_override_a_real_value(self):
        assert apply_spec(AMAZON, {"path": "title", "default": "x"}) != "x"

    def test_pluck_skips_missing_entries_rather_than_emitting_none(self):
        data = {"office": [{"name": "A"}, {"other": "B"}, {"name": "C"}]}
        assert apply_spec(data, {"path": "office", "pluck": "name", "join": ","}) == "A,C"

    def test_rejects_a_spec_that_is_neither_string_nor_object(self):
        with pytest.raises(Exception):
            apply_spec(AMAZON, 42)


class TestMapRecord:
    def test_maps_a_whole_amazon_record(self):
        out = map_record(
            AMAZON,
            {
                "external_job_id": "id_icims",
                "title": "title",
                "location": "location",
                "job_url": {"template": "https://www.amazon.jobs{job_path}"},
            },
        )
        assert out == {
            "external_job_id": "10424837",
            "title": "Software Development Engineer",
            "location": "IN, KA, Bengaluru",
            "job_url": "https://www.amazon.jobs/en/jobs/10424837/sde",
        }

    def test_maps_a_whole_deshaw_record(self):
        out = map_record(
            DESHAW,
            {
                "external_job_id": "id",
                "title": "displayName",
                "location": {"path": "office", "pluck": "name", "join": ", "},
                "job_url": {"template": "https://www.deshawindia.com{data.jobUrl}"},
                "description": "data.jobDescription",
            },
        )
        assert out["external_job_id"] == "2781"
        assert out["location"] == "Hyderabad, Bengaluru"
        assert out["job_url"] == "https://www.deshawindia.com/careers/jobs/2781"

    def test_is_deterministic(self):
        fields = {"a": "title", "b": {"template": "{location}"}}
        assert map_record(AMAZON, fields) == map_record(AMAZON, fields)


class TestJobUrlHostValidation:
    """A field-map template missing its separator produced
    'https://www.deshawindia.comManager-Executive-...' — scheme present, "host" present, and
    completely wrong. The hostname check is what turns that into a loud failure."""

    def test_rejects_a_host_formed_by_a_missing_separator(self):
        from crawler.models.job import NormalizedJob

        with pytest.raises(Exception) as exc:
            NormalizedJob(
                external_job_id="6938",
                title="Manager",
                job_url="https://www.deshawindia.comManager-Executive-Assistant-6938",
            )
        assert "hostname" in str(exc.value).lower() or "separator" in str(exc.value).lower()

    @pytest.mark.parametrize(
        "url",
        [
            "https://www.deshawindia.com/careers/Manager-Executive-Assistant-6938",
            "https://boards.greenhouse.io/databricks/jobs/123",
            "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/x",
            "https://www.amazon.jobs/en/jobs/10424837/sde",
        ],
    )
    def test_accepts_real_job_urls(self, url):
        from crawler.models.job import NormalizedJob

        assert NormalizedJob(external_job_id="1234", title="T", job_url=url).job_url == url


# ---------------------------------------------------------------------------
# Template transforms
# ---------------------------------------------------------------------------


def test_slug_transform_builds_a_url_segment_from_a_display_string():
    """DirectEmployers links a job at /<city-slug>/<title-slug>/<guid>/job/, where the city
    segment is the display location slugified. Deriving it keeps Akamai a config row."""
    record = {
        "location_exact": "Virtual, IND",
        "title_slug": "network-administrator-ii",
        "guid": "830A4E5FB4934FC2BF7B8C7BB48F99C7",
    }
    spec = {"template": "https://akamai.dejobs.org/{location_exact|slug}/{title_slug}/{guid}/job/"}
    assert apply_spec(record, spec) == (
        "https://akamai.dejobs.org/virtual-ind/network-administrator-ii/"
        "830A4E5FB4934FC2BF7B8C7BB48F99C7/job/"
    )


@pytest.mark.parametrize(
    "value,expected",
    [
        ("Charleston, WV", "charleston-wv"),
        ("  São  Paulo  ", "s-o-paulo"),
        ("Bangalore South", "bangalore-south"),
        ("---", ""),
    ],
)
def test_slug_collapses_runs_and_trims_edges(value, expected):
    assert apply_spec({"x": value}, {"template": "{x|slug}"}) == (expected or None)


def test_lower_and_upper_transforms():
    assert apply_spec({"x": "IND"}, {"template": "{x|lower}"}) == "ind"
    assert apply_spec({"x": "ind"}, {"template": "{x|upper}"}) == "IND"


def test_an_unknown_transform_is_a_config_error_not_a_silent_passthrough():
    with pytest.raises(FieldMapError, match="unknown template transform"):
        apply_spec({"x": "a"}, {"template": "{x|slugify}"})
