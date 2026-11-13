from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import handler as seed
import pytest
from botocore.stub import Stubber

SECRET_ARN = "arn:aws:secretsmanager:us-east-2:123456789012:secret:/mall-agents/dev/test-users/x-AbCdEf"
PASSWORD = "Sup3r-Secreta-Que-No-Debe-Aparecer!"


@dataclass
class FakeContext:
    function_name: str = "seed"
    memory_limit_in_mb: int = 256
    invoked_function_arn: str = "arn:aws:lambda:us-east-2:123456789012:function:seed"
    aws_request_id: str = "req-1"


def make_event(request_type: str, **extra: Any) -> dict[str, Any]:
    event: dict[str, Any] = {
        "RequestType": request_type,
        "ResourceProperties": {
            "ServiceToken": "arn:aws:lambda:...",
            "UserPoolId": "us-east-2_pool",
            "Username": "gerente.norte",
            "SecretArn": SECRET_ARN,
        },
    }
    event.update(extra)
    return event


@pytest.fixture
def stubs() -> Iterator[tuple[Stubber, Stubber]]:
    with Stubber(seed.secrets) as sm, Stubber(seed.cognito) as idp:
        yield sm, idp
        sm.assert_no_pending_responses()
        idp.assert_no_pending_responses()


def expect_password_set(sm: Stubber, idp: Stubber) -> None:
    sm.add_response("get_secret_value", {"SecretString": PASSWORD}, {"SecretId": SECRET_ARN})
    idp.add_response(
        "admin_set_user_password",
        {},
        {"UserPoolId": "us-east-2_pool", "Username": "gerente.norte", "Password": PASSWORD, "Permanent": True},
    )


@pytest.mark.parametrize("request_type", ["Create", "Update"])
def test_create_y_update_fijan_password(request_type: str, stubs: tuple[Stubber, Stubber]) -> None:
    expect_password_set(*stubs)
    result = seed.handler(make_event(request_type), FakeContext())
    assert result == {"PhysicalResourceId": "us-east-2_pool/gerente.norte"}


def test_es_idempotente(stubs: tuple[Stubber, Stubber]) -> None:
    expect_password_set(*stubs)
    expect_password_set(*stubs)
    first = seed.handler(make_event("Create"), FakeContext())
    second = seed.handler(make_event("Update"), FakeContext())
    assert first == second


def test_delete_no_llama_apis(stubs: tuple[Stubber, Stubber]) -> None:
    result = seed.handler(make_event("Delete", PhysicalResourceId="pid"), FakeContext())
    assert result == {"PhysicalResourceId": "pid"}


def test_propiedades_faltantes_fallan(stubs: tuple[Stubber, Stubber]) -> None:
    event = make_event("Create")
    del event["ResourceProperties"]["SecretArn"]
    with pytest.raises(seed.InvalidRequestError):
        seed.handler(event, FakeContext())


def test_password_nunca_aparece_en_logs(stubs: tuple[Stubber, Stubber], capsys: pytest.CaptureFixture[str]) -> None:
    expect_password_set(*stubs)
    seed.handler(make_event("Create"), FakeContext())
    captured = capsys.readouterr()
    assert PASSWORD not in captured.out
    assert PASSWORD not in captured.err
