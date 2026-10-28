"""A new opening at a company with an HR contact should say who to call, in the email itself."""

from crawler.notify import build_digest


def _note(company: str, title: str, hr: list[dict] | None = None) -> dict:
    return {
        "job": {
            "title": title,
            "company": company,
            "location": "Bangalore",
            "url": "https://example.com/j",
            "match_score": 90,
            "hr_contacts": hr or [],
        }
    }


def test_names_the_hr_contact_under_its_company():
    _, text, html = build_digest(
        [_note("CRED", "Software Engineer II", [{"name": "Priya", "phone": "+91 98765 43210"}])]
    )
    assert "Call HR: Priya (+91 98765 43210)" in text
    assert "Call HR: Priya (+91 98765 43210)" in html


def test_says_nothing_when_the_company_has_no_hr_contact():
    _, text, html = build_digest([_note("Adobe", "MTS II")])
    assert "Call HR" not in text
    assert "Call HR" not in html


def test_older_outbox_payloads_without_the_field_still_render():
    note = _note("Adobe", "MTS II")
    del note["job"]["hr_contacts"]
    _, text, _ = build_digest([note])
    assert "Adobe" in text and "Call HR" not in text
