"""A MyNextHire job link is base64-encoded JSON, and only the full object opens the job.

The expected value below is the link ShareChat's own careers page builds for requisition 2473,
and was confirmed in a browser to render that job's description. A minimal object carrying only
pageType and reqId renders "Oops! Something went wrong!" instead -- which is why this pins the
exact bytes rather than merely checking that the link decodes to something with a reqId.
"""

from __future__ import annotations

import base64
import json
from urllib.parse import parse_qs, urlsplit

from crawler.adapters.mynexthire import job_url

SHARECHAT_2473 = (
    "https://sharechat.mynexthire.com/employer/jobs?src=careers&p="
    "eyJwYWdlVHlwZSI6ImpkIiwiY3ZTb3VyY2UiOiJjYXJlZXJzIiwicmVxSWQiOjI0NzMsInJlcXVlc3RlciI6eyJpZCI6"
    "IiIsImNvZGUiOiIiLCJuYW1lIjoiIn0sInBhZ2UiOiJjYXJlZXJzIiwiYnVmaWx0ZXIiOi0xLCJjdXN0b21GaWVsZHMi"
    "Ont9fQ=="
)


def test_matches_the_link_the_careers_page_builds():
    assert job_url("sharechat", 2473) == SHARECHAT_2473


def test_carries_the_requisition_id():
    p = parse_qs(urlsplit(job_url("sharechat", "2454")).query)["p"][0]
    assert json.loads(base64.b64decode(p))["reqId"] == 2454
